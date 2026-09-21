import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, Brackets } from 'typeorm';
import MercadoPagoConfig, { Order, Payment, User } from 'mercadopago';
import { CreateSpeiDto } from './dto/create-spei.dto';
import { QuerySpeiDto } from './dto/query-spei.dto';
import { FilterSpeiDto } from './dto/filter-spei.dto';
import { SpeiPayment } from './entities/spei-payment.entity';
import { ProjectsService } from '../projects/projects.service';

/** Estados en los que la CLABE sigue viva y se puede reutilizar. */
const PENDING_STATUSES = ['action_required', 'pending', 'processing'];
/** Estados terminales sin acreditación. */
const FAILED_STATUSES = ['rejected', 'cancelled', 'canceled', 'expired', 'refunded', 'charged_back'];

type MpAccountOwner = {
  id: number | null;
  nickname: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
};

@Injectable()
export class SpeiService implements OnModuleInit {
  private readonly logger = new Logger(SpeiService.name);
  private readonly mpClient: MercadoPagoConfig;
  private readonly order: Order;
  private readonly payment: Payment;
  private readonly user: User;
  private accountOwner: MpAccountOwner | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly projectsService: ProjectsService,
    @InjectRepository(SpeiPayment)
    private readonly repo: Repository<SpeiPayment>,
  ) {
    const accessToken = this.config.get<string>('MP_ACCESS_TOKEN') ?? '';
    this.logger.log(
      `MP credenciales → ${accessToken.startsWith('TEST-') ? '🧪 SANDBOX' : '✅ PROD'} | ` +
      `app: ${accessToken.split('-')[1]} | cuenta: ${accessToken.split('-').pop()}`,
    );

    this.mpClient = new MercadoPagoConfig({
      accessToken,
      options: { timeout: 10000 },
    });
    this.order = new Order(this.mpClient);
    this.payment = new Payment(this.mpClient);
    this.user = new User(this.mpClient);
  }

  async onModuleInit() {
    await this.ensureSchema();
    await this.loadAccountOwner();
  }

  private async loadAccountOwner() {
    try {
      const me = await this.user.get() as any;
      const first = me?.first_name?.trim() || null;
      const last = me?.last_name?.trim() || null;
      const full = [first, last].filter(Boolean).join(' ') || me?.nickname || null;
      this.accountOwner = {
        id: me?.id != null ? Number(me.id) : null,
        nickname: me?.nickname ?? null,
        first_name: first,
        last_name: last,
        full_name: full,
        email: me?.email ?? null,
      };
      this.logger.log(`MP cuenta → ${full ?? 'N/A'} (id: ${this.accountOwner.id ?? 'N/A'})`);
    } catch (err) {
      this.logger.warn(`No se pudo obtener el dueño de la cuenta MP: ${err?.message ?? err}`);
      this.accountOwner = null;
    }
  }

  private async getAccountOwner(): Promise<MpAccountOwner | null> {
    if (!this.accountOwner) await this.loadAccountOwner();
    return this.accountOwner;
  }

  /**
   * Crea la tabla propia si no existe. Es idempotente y NO altera tablas ajenas
   * (la BD está compartida con mercadopago-nest, por eso synchronize sigue en false).
   */
  private async ensureSchema() {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS SpeiPayments (
          Id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          OrderId           VARCHAR(50)  NOT NULL,
          PaymentId         VARCHAR(50)  NOT NULL,
          Status            VARCHAR(30)  NOT NULL,
          StatusDetail      VARCHAR(60)  NULL,
          Clabe             VARCHAR(30)  NULL,
          Referencia        VARCHAR(45)  NULL,
          Banco             VARCHAR(60)  NULL,
          Amount            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
          Currency          VARCHAR(5)   NOT NULL DEFAULT 'MXN',
          PayerEmail        VARCHAR(150) NULL,
          Description       VARCHAR(255) NULL,
          ExternalReference VARCHAR(255) NULL,
          TicketUrl         VARCHAR(500) NULL,
          FhExpiracion      DATETIME     NULL,
          FhAcreditacion    DATETIME     NULL,
          Notified          TINYINT(1)   NOT NULL DEFAULT 0,
          FhRegistro        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FhActualizacion   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          BusinessName      VARCHAR(100) NULL,
          IdProject         BIGINT       NULL,
          PRIMARY KEY (Id),
          UNIQUE KEY UK_Spei_PaymentId (PaymentId),
          KEY IDX_Spei_OrderId (OrderId),
          KEY IDX_Spei_Status (Status),
          KEY IDX_Spei_ExternalReference (ExternalReference)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await this.migrateSchema();
      this.logger.log('DB ✅ Tabla SpeiPayments lista');
    } catch (err) {
      this.logger.error(`DB ❌ No se pudo verificar/crear SpeiPayments: ${err.message}`);
    }
  }

  /** Alinea tablas ya existentes: quita ClientId/IdHistoryBalance y agrega BusinessName/IdProject. */
  private async migrateSchema() {
    const has = async (column: string) => {
      const rows = await this.dataSource.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SpeiPayments' AND COLUMN_NAME = ?`,
        [column],
      );
      return Number(rows[0]?.c) > 0;
    };

    if (await has('IdHistoryBalance')) {
      await this.dataSource.query('ALTER TABLE SpeiPayments DROP COLUMN IdHistoryBalance');
    }
    if (await has('ClientId')) {
      await this.dataSource.query('ALTER TABLE SpeiPayments DROP COLUMN ClientId');
    }
    if (!(await has('BusinessName'))) {
      await this.dataSource.query(
        'ALTER TABLE SpeiPayments ADD COLUMN BusinessName VARCHAR(100) NULL AFTER FhActualizacion',
      );
    }
    if (!(await has('IdProject'))) {
      await this.dataSource.query(
        'ALTER TABLE SpeiPayments ADD COLUMN IdProject BIGINT NULL AFTER BusinessName',
      );
    }
  }

  // ───────────────────────────── Helpers MP ─────────────────────────────

  /**
   * SPEI usa Orders API (/v1/orders) con credenciales APP_USR.
   * MP no acepta credenciales TEST- ahí; en sandbox se usa APP_USR + comprador @testuser.com.
   */
  private resolvePayerEmail(email: string): string {
    const normalized = email?.trim();
    if (!normalized) {
      throw new BadRequestException('Falta payer.email en la petición SPEI.');
    }
    if (normalized.toLowerCase().endsWith('@testuser.com')) return normalized;

    const testBuyer = this.config.get<string>('MP_TEST_BUYER_EMAIL');
    return testBuyer?.trim() ? testBuyer.trim() : normalized;
  }

  private parseExternalRef(ref: string): { orderId?: string } {
    if (!ref) return {};
    // Formato actual: "o_{orderId}"  | legacy: "c_{clientId}__o_{orderId}"
    const match = ref.match(/^(?:c_.+?__)?o_(.+)$/);
    return { orderId: match?.[1] };
  }

  private extractNumericPaymentId(ticketUrl?: string | null): string | null {
    if (!ticketUrl) return null;
    return ticketUrl.match(/\/payments\/(\d+)\//)?.[1] ?? null;
  }

  /** Normaliza la respuesta de MP (Order o Payment) a una forma única. */
  private extractSpeiData(source: any) {
    const isOrder = source?.transactions?.payments != null;
    const firstPayment = isOrder ? source.transactions.payments[0] : source;
    const pm = firstPayment?.payment_method ?? source?.payment_method;
    const td = source?.transaction_details ?? firstPayment?.transaction_details;

    const clabe =
      pm?.data?.reference_id ?? td?.payment_method_reference_id ?? pm?.reference ?? null;

    const referencia =
      pm?.data?.external_reference_id ?? td?.acquirer_reference ?? null;

    return {
      order_id:           isOrder ? String(source.id) : String(source.order?.id ?? source.id),
      payment_id:         String(firstPayment?.id ?? source.id),
      status:             source.status ?? firstPayment?.status,
      status_detail:      source.status_detail ?? firstPayment?.status_detail,
      clabe:              clabe ? String(clabe) : null,
      referencia:         referencia ? String(referencia) : null,
      banco:              td?.financial_institution ?? 'STP',
      amount:             source.total_amount ?? source.transaction_amount,
      currency:           source.currency ?? source.currency_id ?? 'MXN',
      payer_email:        source.payer?.email ?? firstPayment?.payer?.email ?? null,
      external_reference: source.external_reference,
      date_of_expiration: firstPayment?.date_of_expiration ?? source.date_of_expiration,
      date_approved:      source.date_approved ?? firstPayment?.date_approved,
      money_release_date: source.money_release_date ?? firstPayment?.money_release_date ?? null,
      money_release_status: source.money_release_status ?? firstPayment?.money_release_status ?? null,
      net_received_amount: td?.net_received_amount ?? null,
      numeric_payment_id: this.extractNumericPaymentId(
        pm?.ticket_url ?? pm?.data?.external_resource_url ?? td?.external_resource_url,
      ),
      ticket_url:         pm?.ticket_url ?? pm?.data?.external_resource_url ?? td?.external_resource_url ?? null,
    };
  }

  /**
   * La orden a veces no trae CLABE/referencia ni money_release_date;
   * el Payment numérico enlazado sí. Se saca ese id del ticket_url.
   */
  private async enrichFromPayment<T extends {
    clabe?: string | null;
    referencia?: string | null;
    ticket_url?: string | null;
    money_release_date?: string | null;
    money_release_status?: string | null;
    date_approved?: string | null;
    net_received_amount?: string | number | null;
    numeric_payment_id?: string | null;
  }>(spei: T, orderSource?: any, opts?: { forcePaymentLookup?: boolean }): Promise<T> {
    const needsRelease = opts?.forcePaymentLookup || !spei.money_release_date;
    if (spei.referencia && spei.clabe && !needsRelease) return spei;

    const ticketUrl =
      orderSource?.transactions?.payments?.[0]?.payment_method?.ticket_url ?? spei.ticket_url;
    const paymentId =
      spei.numeric_payment_id ??
      this.extractNumericPaymentId(ticketUrl);
    if (!paymentId) return spei;

    try {
      const payment = (await this.payment.get({ id: paymentId })) as any;
      const enriched = this.extractSpeiData(payment);
      return {
        ...spei,
        clabe:               spei.clabe ?? enriched.clabe,
        referencia:          spei.referencia ?? enriched.referencia,
        ticket_url:          spei.ticket_url ?? enriched.ticket_url,
        date_approved:       spei.date_approved ?? enriched.date_approved,
        money_release_date:  spei.money_release_date ?? enriched.money_release_date,
        money_release_status: spei.money_release_status ?? enriched.money_release_status,
        net_received_amount: spei.net_received_amount ?? enriched.net_received_amount,
        numeric_payment_id:  paymentId,
      };
    } catch {
      return spei;
    }
  }

  private isAccredited(status?: string, detail?: string): boolean {
    const s = String(status ?? '').toLowerCase();
    const d = String(detail ?? '').toLowerCase();
    return d === 'accredited' || s === 'approved' || (s === 'processed' && d === 'accredited');
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractMpErrorMessage(error: any, fallback: string): string {
    const src = error?.cause ?? error;
    if (typeof src === 'string') return src;

    const mpErrors = src?.errors;
    if (Array.isArray(mpErrors) && mpErrors.length > 0) {
      const e = mpErrors[0];
      const detail = src?.data?.transactions?.payments?.[0]?.status_detail;
      return [e.message, ...(e.details ?? []), detail].filter(Boolean).join(' — ');
    }
    if (Array.isArray(src) && src[0]?.description) return src[0].description;
    if (src?.message) return String(src.message);

    const detail = src?.data?.transactions?.payments?.[0]?.status_detail;
    return detail ? String(detail) : fallback;
  }

  /**
   * El SDK oficial de MP descarta headers en 4xx/5xx (`throw await response.json()`).
   * Por eso createOrderWithRetry usa fetch propio y adjunta x-request-id al error.
   */
  private extractMpRequestId(errorOrResponse: any): string | null {
    const candidates = [
      errorOrResponse?.x_request_id,
      errorOrResponse?.headers?.['x-request-id'],
      errorOrResponse?.headers?.['X-Request-Id'],
      errorOrResponse?.response?.headers?.['x-request-id'],
      errorOrResponse?.cause?.headers?.['x-request-id'],
      errorOrResponse?.api_response?.headers?.['x-request-id'],
    ];

    for (const value of candidates) {
      const id = Array.isArray(value) ? value[0] : value;
      if (id && typeof id === 'string') return id;
    }
    return null;
  }

  private mapMpError(message: string, requestId?: string | null): string {
    const rules: Array<[RegExp, string]> = [
      [/processing_error/i,
        'Mercado Pago no pudo generar una CLABE nueva (processing_error). El fallo es del procesador ' +
        'SPEI de MP, no de la integración. Si ya hay una transferencia pendiente, reutilízala. ' +
        'Si persiste, contacta soporte MP con el x-request-id del log y verifica que la cuenta ' +
        'vendedora tenga SPEI/transferencias habilitado.'],
      [/payer email forbidden/i,
        'Email de comprador no válido para SPEI. En sandbox usa el @testuser.com del COMPRADOR de ' +
        'prueba de la misma app que MP_ACCESS_TOKEN.'],
      [/invalid_credentials|test credentials are not supported/i,
        'SPEI requiere Orders API con MP_ACCESS_TOKEN (APP_USR). Las credenciales TEST- no funcionan en /v1/orders.'],
    ];
    const mapped = rules.find(([re]) => re.test(message))?.[1] ?? message;
    return requestId ? `${mapped} [x-request-id: ${requestId}]` : mapped;
  }

  private isProcessingError(error: any): boolean {
    return /processing_error/i.test(this.extractMpErrorMessage(error, ''));
  }

  // ───────────────────────────── Crear SPEI ─────────────────────────────

  /** Evita crear otra orden en MP si ya hay una SPEI pendiente con la misma ref y monto. */
  private async findReusablePending(externalRef: string, amount: number) {
    const rows = await this.repo.find({
      where: { externalReference: externalRef, status: In(PENDING_STATUSES) },
      order: { fhRegistro: 'DESC' },
      take: 5,
    });

    for (const row of rows) {
      if (Math.abs(Number(row.amount) - amount) > 0.009) continue;
      if (!row.orderId?.startsWith('ORD')) continue;

      try {
        const raw = await this.order.get({ id: row.orderId } as any);
        const spei = await this.enrichFromPayment(this.extractSpeiData(raw), raw);
        if (!PENDING_STATUSES.includes(String(spei.status)) || !spei.clabe) continue;
        return spei;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * POST /v1/orders con fetch propio para conservar x-request-id
   * (el SDK de MP lo pierde al hacer throw del body en errores).
   */
  private async createOrderWithRetry(body: Record<string, unknown>, idempotencyKey: string) {
    const maxAttempts = 3;
    let lastError: any;
    const accessToken = this.config.get<string>('MP_ACCESS_TOKEN') ?? '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const key = `${idempotencyKey}-a${attempt}`;
      try {
        const res = await fetch('https://api.mercadopago.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': key,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });

        const requestId =
          res.headers.get('x-request-id') ??
          res.headers.get('X-Request-Id');

        let data: any = null;
        const text = await res.text();
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }

        if (requestId) {
          this.logger.log(`SPEI MP x-request-id: ${requestId} (attempt ${attempt}/${maxAttempts})`);
        }

        if (!res.ok) {
          const err: any = typeof data === 'object' && data ? data : { message: text || res.statusText };
          err.status = res.status;
          err.x_request_id = requestId;
          err.headers = { 'x-request-id': requestId };
          throw err;
        }

        // processing_error a veces viene en 200/201 con status failed en el body
        const statusDetail = data?.transactions?.payments?.[0]?.status_detail
          ?? data?.status_detail;
        if (String(statusDetail).toLowerCase() === 'processing_error' || data?.status === 'failed') {
          const err: any = {
            errors: [{
              code: 'failed',
              message: 'The following transactions failed',
              details: (data?.transactions?.payments ?? []).map(
                (p: any) => `${p.id}: ${p.status_detail ?? p.status}`,
              ),
            }],
            data,
            status: res.status,
            x_request_id: requestId,
            headers: { 'x-request-id': requestId },
          };
          throw err;
        }

        return data;
      } catch (error) {
        lastError = error;
        const requestId = this.extractMpRequestId(error);
        if (requestId) {
          this.logger.warn(`SPEI error x-request-id: ${requestId}`);
        }
        if (!this.isProcessingError(error) || attempt === maxAttempts) throw error;
        this.logger.warn(`SPEI processing_error — reintento ${attempt}/${maxAttempts - 1}`);
        await this.delay(1500 * attempt);
      }
    }
    throw lastError;
  }

  async createSpei(dto: CreateSpeiDto, apiKey?: string) {
    let businessName = dto.business_name?.trim() ?? '';
    let idProject: number | null = null;

    if (apiKey?.trim()) {
      const project = await this.projectsService.resolveByApiKey(apiKey);
      businessName = project.name;
      idProject = project.id;
      this.logger.log(`SPEI → ApiKey OK | project #${project.id} (${businessName})`);
    } else if (businessName) {
      const project = await this.projectsService.resolveByName(businessName);
      businessName = project.name;
      idProject = project.id;
    } else {
      throw new BadRequestException(
        'Indica business_name en el body o el header ApiKey del Project.',
      );
    }

    const ordRef = dto.external_reference ?? `${Date.now()}`;
    const externalRef = `o_${ordRef}`;

    const amount = dto.transaction_amount.toFixed(2);
    const payerEmail = this.resolvePayerEmail(dto.payer.email);

    this.logger.log(
      `SPEI → Orders API | project #${idProject} | business: ${businessName} | ref: ${externalRef} | monto: ${amount} | payer: ${payerEmail}`,
    );

    const existing = await this.findReusablePending(externalRef, dto.transaction_amount);
    if (existing) {
      this.logger.log(`SPEI → reutilizando orden pendiente ${existing.order_id}`);
      await this.persist(existing, dto, payerEmail, businessName, idProject);
      return this.buildResponse(existing, businessName, idProject, true);
    }

    const orderBody = {
      type: 'online',
      processing_mode: 'automatic',
      marketplace: 'NONE',
      total_amount: amount,
      external_reference: externalRef,
      ...(dto.description && { description: dto.description }),
      payer: { email: payerEmail, first_name: 'Comprador' },
      transactions: {
        payments: [{
          amount,
          payment_method: { id: 'clabe', type: 'bank_transfer' },
        }],
      },
    };

    try {
      const response = await this.createOrderWithRetry(
        orderBody,
        `spei-${externalRef}-${amount}-${Date.now()}`,
      );
      const raw = response as any;
      const spei = await this.enrichFromPayment(this.extractSpeiData(raw), raw);

      this.logger.log(`SPEI creado: ${spei.order_id} | CLABE: ${spei.clabe} | Ref: ${spei.referencia}`);

      await this.persist(spei, dto, payerEmail, businessName, idProject);
      const result = this.buildResponse(spei, businessName, idProject);
      await this.forward(result);
      return result;

    } catch (error) {
      if (this.isProcessingError(error)) {
        const fallback = await this.findReusablePending(externalRef, dto.transaction_amount);
        if (fallback) {
          this.logger.warn(`SPEI processing_error — devolviendo orden pendiente ${fallback.order_id}`);
          await this.persist(fallback, dto, payerEmail, businessName, idProject);
          return this.buildResponse(fallback, businessName, idProject, true);
        }
      }

      const rawMessage = this.extractMpErrorMessage(error, 'No se pudo generar el pago SPEI');
      const requestId = this.extractMpRequestId(error);
      this.logger.error(
        `Error al crear SPEI (payer: ${payerEmail})${requestId ? ` | x-request-id: ${requestId}` : ''}`,
        rawMessage,
        JSON.stringify(error?.cause ?? error),
      );
      throw new BadRequestException(this.mapMpError(String(rawMessage), requestId));
    }
  }

  private buildResponse(
    spei: ReturnType<SpeiService['extractSpeiData']>,
    businessName: string,
    idProject: number | null,
    reused = false,
  ) {
    return {
      order_id:           spei.order_id,
      payment_id:         spei.payment_id,
      status:             spei.status,
      status_detail:      spei.status_detail,
      clabe:              spei.clabe,
      referencia:         spei.referencia,
      banco:              spei.banco,
      amount:             spei.amount,
      currency:           spei.currency,
      external_reference: spei.external_reference,
      date_of_expiration: spei.date_of_expiration,
      ticket_url:         spei.ticket_url,
      business_name:      businessName,
      id_project:         idProject,
      ...(reused && { reused_pending: true }),
    };
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Formato legible en zona México: dd/MM/yyyy HH:mm:ss */
  private formatDateTime(value: any): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);

    const parts = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
  }

  private async persist(
    spei: ReturnType<SpeiService['extractSpeiData']>,
    dto: CreateSpeiDto | null,
    payerEmail?: string,
    businessName?: string | null,
    idProject?: number | null,
  ) {
    try {
      await this.repo.upsert(
        {
          orderId:           spei.order_id,
          paymentId:         spei.payment_id,
          status:            spei.status ?? 'action_required',
          statusDetail:      spei.status_detail ?? null,
          clabe:             spei.clabe ?? null,
          referencia:        spei.referencia ?? null,
          banco:             spei.banco ?? null,
          amount:            Number(spei.amount ?? 0),
          currency:          spei.currency ?? 'MXN',
          payerEmail:        payerEmail ?? spei.payer_email ?? null,
          description:       dto?.description ?? null,
          externalReference: spei.external_reference ?? null,
          businessName:      dto?.business_name?.trim() || businessName || null,
          idProject:         idProject ?? null,
          ticketUrl:         spei.ticket_url ?? null,
          fhExpiracion:      this.toDate(spei.date_of_expiration),
          fhAcreditacion:    this.toDate(spei.date_approved),
        },
        ['paymentId'],
      );
      this.logger.log(`DB ✅ SPEI guardado — PaymentId: ${spei.payment_id} | IdProject: ${idProject ?? 'N/A'}`);
    } catch (err) {
      this.logger.error(`DB ❌ Error guardando SPEI: ${err.message}`, err.stack);
    }
  }

  /** Reenvía el evento ya procesado a otra API si MP_WEBHOOK_FORWARD_URL está configurada. */
  private async forward(payload: Record<string, any>, url?: string | null) {
    const target = (url ?? this.config.get<string>('MP_WEBHOOK_FORWARD_URL'))?.trim();
    if (!target) return false;

    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      this.logger.log(`Forward → ${res.status} ${target}`);
      return res.ok;
    } catch (err) {
      this.logger.warn(`No se pudo hacer forward a ${target}: ${err.message}`);
      return false;
    }
  }

  /**
   * Notifica al proyecto dueño cuando el SPEI queda acreditado.
   * Usa Projects.WebhookUrl; si no hay URL, no hace nada.
   */
  private async notifyProjectAccredited(payload: Record<string, any>) {
    const idProject = payload?.id_project != null ? Number(payload.id_project) : null;
    if (!idProject) {
      this.logger.warn('Acreditación sin IdProject — no se notifica a proyecto');
      return false;
    }

    const webhookUrl = await this.projectsService.getWebhookUrl(idProject);
    if (!webhookUrl) {
      this.logger.warn(
        `Proyecto #${idProject} sin WebhookUrl — omitiendo notificación de acreditación`,
      );
      return false;
    }

    return this.forward(
      {
        event: 'spei.accredited',
        ...payload,
        status: 'processed',
      },
      webhookUrl,
    );
  }

  // ───────────────────────────── Consultas MP ─────────────────────────────

  /** Consulta el estado real en MP (por OrderId ORD... o PaymentId numérico). */
  async getFromMercadoPago(id: string) {
    try {
      const raw = id.startsWith('ORD')
        ? await this.order.get({ id } as any)
        : await this.payment.get({ id });
      // Orders no trae money_release_*; se completa desde el Payment numérico del ticket.
      const spei = await this.enrichFromPayment(this.extractSpeiData(raw), raw, {
        forcePaymentLookup: true,
      });
      const owner = await this.getAccountOwner();
      return {
        order_id:             spei.order_id,
        payment_id:           spei.payment_id,
        numeric_payment_id:   spei.numeric_payment_id,
        status:               spei.status,
        status_detail:        spei.status_detail,
        clabe:                spei.clabe,
        referencia:           spei.referencia,
        banco:                spei.banco,
        amount:               spei.amount,
        currency:             spei.currency,
        external_reference:   spei.external_reference,
        date_of_expiration:   this.formatDateTime(spei.date_of_expiration),
        date_approved:        this.formatDateTime(spei.date_approved),
        money_release_date:   this.formatDateTime(spei.money_release_date),
        money_release_status: spei.money_release_status,
        net_received_amount:  spei.net_received_amount,
        ticket_url:           spei.ticket_url,
        account_owner:        owner,
      };
    } catch (error) {
      this.logger.error(`Error al obtener SPEI ${id}`, this.extractMpErrorMessage(error, String(error)));
      throw new NotFoundException(`Pago SPEI ${id} no encontrado en Mercado Pago`);
    }
  }

  /** Re-sincroniza un registro contra MP (botón "Actualizar" del dashboard). */
  async refresh(id: string) {
    const row = await this.repo.findOne({
      where: [{ paymentId: id }, { orderId: id }],
    });
    const mpId = row?.orderId ?? id;
    const data = await this.getFromMercadoPago(mpId);

    await this.persist(data as any, null, row?.payerEmail, row?.businessName, row?.idProject);

    return {
      refreshed: true,
      ...data,
      business_name: row?.businessName ?? null,
      id_project: row?.idProject != null ? Number(row.idProject) : null,
    };
  }

  // ───────────────────────────── Webhook ─────────────────────────────

  /**
   * Webhook de Mercado Pago (evento "Pagos"). MP puede mandar el id de la ORDEN
   * (ORD...) o el id numérico del PAGO; se resuelve a la orden cuando es posible.
   */
  async handleWebhook(body: any) {
    const type = body?.type ?? body?.topic ?? body?.action;
    const resourceId = body?.data?.id ?? body?.id ?? body?.resource;
    if (!resourceId) return { received: true };

    this.logger.log(`Webhook recibido — tipo: ${type ?? 'N/A'} | id: ${resourceId}`);

    try {
      const raw = await this.resolveNotificationSource(String(resourceId));
      const data = await this.enrichFromPayment(this.extractSpeiData(raw), raw);
      const { orderId } = this.parseExternalRef(data.external_reference ?? '');

      this.logger.log(
        `Webhook — orden: ${data.order_id ?? orderId ?? 'N/A'} | ` +
        `pago: ${data.payment_id} | estado: ${data.status} (${data.status_detail})`,
      );

      // MP entrega el id numérico del pago, distinto del id Orders (PAY...) que
      // guardamos al crear. Primero se intenta conciliar el registro existente.
      const reconciled = await this.reconcile(data);
      if (!reconciled) {
        await this.persist(data, null);
      }

      const accredited = this.isAccredited(data.status, data.status_detail);
      const payload = {
        order_id:           reconciled?.orderId ?? data.order_id ?? orderId ?? null,
        payment_id:         data.payment_id,
        status:             accredited ? 'processed' : (data.status ?? ''),
        status_detail:      data.status_detail,
        amount:             data.amount,
        currency:           data.currency,
        clabe:              data.clabe,
        referencia:         data.referencia,
        banco:              data.banco,
        external_reference: data.external_reference ?? null,
        date_approved:      data.date_approved,
        business_name:      reconciled?.businessName ?? null,
        id_project:         reconciled?.idProject != null ? Number(reconciled.idProject) : null,
      };

      const row = reconciled ?? await this.repo.findOne({ where: { paymentId: data.payment_id } });
      if (row?.notified) {
        this.logger.warn(`Webhook — notificación omitida (ya notificado): pago ${data.payment_id}`);
      } else {
        // Forward global opcional (cualquier actualización)
        await this.forward(payload);

        // Aviso al proyecto solo cuando el pago quedó acreditado
        if (accredited) {
          await this.notifyProjectAccredited(payload);
          if (row) {
            row.notified = true;
            await this.repo.save(row);
          }
        }
      }

      this.logger.log(`Webhook ✅ procesado — pago ${data.payment_id} | status: ${data.status}`);
      return { received: true, ...payload };

    } catch (error) {
      const httpStatus = error?.status ?? error?.cause?.status;
      this.logger.error(
        `Error procesando webhook (id: ${resourceId})`,
        this.extractMpErrorMessage(error, String(error)),
      );
      // 404 = recurso ajeno/inexistente → no tiene caso que MP reintente.
      if (httpStatus === 404) return { received: true };
      // Fallos transitorios → 5xx para que Mercado Pago reintente.
      throw new HttpException(
        { received: false, error: 'webhook_processing_failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** Resuelve el recurso de una notificación a su ORDEN (preferido) o pago. */
  private async resolveNotificationSource(resourceId: string): Promise<any> {
    const id = String(resourceId);
    if (id.startsWith('ORD')) return this.order.get({ id } as any);

    const payment = (await this.payment.get({ id })) as any;
    const linkedOrderId = payment?.order?.id;
    if (linkedOrderId && String(linkedOrderId).startsWith('ORD')) {
      try {
        return await this.order.get({ id: String(linkedOrderId) } as any);
      } catch {
        return payment;
      }
    }
    return payment;
  }

  /**
   * Actualiza el registro pendiente que coincide por external_reference (u orderId) + monto,
   * preservando su OrderId/PaymentId originales. Evita duplicados por el doble id de MP.
   */
  private async reconcile(data: ReturnType<SpeiService['extractSpeiData']>): Promise<SpeiPayment | null> {
    const amount = Number(data.amount ?? 0);
    const matches = (r: SpeiPayment) => Math.abs(Number(r.amount) - amount) < 0.009;

    let rows: SpeiPayment[] = [];
    if (data.external_reference) {
      rows = await this.repo.find({
        where: { externalReference: data.external_reference },
        order: { fhRegistro: 'DESC' },
        take: 20,
      });
    }
    if (rows.length === 0 && data.order_id) {
      rows = await this.repo.find({
        where: { orderId: String(data.order_id) },
        order: { fhRegistro: 'DESC' },
        take: 5,
      });
    }
    if (rows.length === 0) return null;

    const target =
      rows.find((r) => matches(r) && PENDING_STATUSES.includes(r.status)) ??
      rows.find(matches);
    if (!target) return null;

    target.status = data.status ?? target.status;
    target.statusDetail = data.status_detail ?? target.statusDetail;
    if (data.referencia) target.referencia = data.referencia;
    if (data.clabe) target.clabe = data.clabe;
    const approved = this.toDate(data.date_approved);
    if (approved) target.fhAcreditacion = approved;

    await this.repo.save(target);
    this.logger.log(
      `DB ✅ Conciliado #${target.id} (${target.orderId}) → ${data.status} (${data.status_detail})`,
    );
    return target;
  }

  /** 🧪 Reproduce el flujo del webhook real sin esperar la notificación de MP. */
  async simulateWebhook(id: string) {
    this.logger.log(`🧪 Simulando webhook SPEI — id: ${id}`);
    return this.handleWebhook({ data: { id } });
  }

  // ───────────────────────────── Dashboard ─────────────────────────────

  /** Agrupa los estados de MP en las 3 categorías que muestra el dashboard. */
  private groupOf(status: string, detail: string | null, expiracion: Date | null): string {
    if (this.isAccredited(status, detail)) return 'accredited';
    if (FAILED_STATUSES.includes(String(status).toLowerCase())) return 'failed';
    if (expiracion && new Date(expiracion).getTime() < Date.now()) return 'failed';
    return 'pending';
  }

  private toListItem(r: SpeiPayment) {
    const grupo = this.groupOf(r.status, r.statusDetail, r.fhExpiracion);
    return {
      id:                 Number(r.id),
      order_id:           r.orderId,
      payment_id:         r.paymentId,
      status:             r.status,
      status_detail:      r.statusDetail,
      grupo,
      clabe:              r.clabe,
      referencia:         r.referencia,
      banco:              r.banco,
      amount:             Number(r.amount),
      currency:           r.currency,
      payer_email:        r.payerEmail,
      description:        r.description,
      external_reference: r.externalReference,
      business_name:      r.businessName,
      id_project:         r.idProject != null ? Number(r.idProject) : null,
      ticket_url:         r.ticketUrl,
      fh_expiracion:      r.fhExpiracion,
      fh_acreditacion:    r.fhAcreditacion,
      fh_registro:        r.fhRegistro,
      fh_actualizacion:   r.fhActualizacion,
    };
  }

  private applyFilters(qb: ReturnType<Repository<SpeiPayment>['createQueryBuilder']>, q: QuerySpeiDto) {
    if (q.search?.trim()) {
      const term = `%${q.search.trim()}%`;
      qb.andWhere(new Brackets((w) => {
        w.where('s.OrderId LIKE :term', { term })
          .orWhere('s.PaymentId LIKE :term', { term })
          .orWhere('s.ExternalReference LIKE :term', { term })
          .orWhere('s.Referencia LIKE :term', { term })
          .orWhere('s.Clabe LIKE :term', { term })
          .orWhere('s.PayerEmail LIKE :term', { term })
          .orWhere('s.BusinessName LIKE :term', { term });
      }));
    }
    if (q.from) qb.andWhere('s.FhRegistro >= :from', { from: `${q.from} 00:00:00` });
    if (q.to) qb.andWhere('s.FhRegistro <= :to', { to: `${q.to} 23:59:59` });

    // El grupo depende de status + detalle + expiración; se resuelve en SQL para
    // que la paginación sea correcta.
    if (q.status === 'accredited') {
      qb.andWhere('(LOWER(s.StatusDetail) = :acc OR LOWER(s.Status) IN (:...okStatus))', {
        acc: 'accredited',
        okStatus: ['approved'],
      });
    } else if (q.status === 'failed') {
      qb.andWhere(new Brackets((w) => {
        w.where('LOWER(s.Status) IN (:...failed)', { failed: FAILED_STATUSES })
          .orWhere('(s.FhExpiracion IS NOT NULL AND s.FhExpiracion < NOW() AND LOWER(s.Status) IN (:...pending))', {
            pending: PENDING_STATUSES,
          });
      }));
    } else if (q.status === 'pending') {
      qb.andWhere('LOWER(s.Status) IN (:...pending)', { pending: PENDING_STATUSES })
        .andWhere('(LOWER(COALESCE(s.StatusDetail, \'\')) <> :acc)', { acc: 'accredited' })
        .andWhere('(s.FhExpiracion IS NULL OR s.FhExpiracion >= NOW())');
    }
    return qb;
  }

  async list(q: QuerySpeiDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;

    const qb = this.repo.createQueryBuilder('s');
    this.applyFilters(qb, q);

    const [rows, total] = await qb
      .orderBy('s.FhRegistro', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: rows.map((r) => this.toListItem(r)),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * Listado para sistemas externos: autenticado por ApiKey del Project,
   * con rango de fechas, estatus opcional y paginación.
   */
  async searchByApiKey(dto: FilterSpeiDto, apiKey?: string) {
    const project = await this.projectsService.resolveByApiKey(apiKey ?? '');
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;

    const qb = this.repo.createQueryBuilder('s');
    qb.andWhere('s.IdProject = :idProject', { idProject: project.id });
    this.applyFilters(qb, {
      from: dto.from,
      to: dto.to,
      status: dto.status ?? 'all',
    });

    const [rows, total] = await qb
      .orderBy('s.FhRegistro', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      id_project: project.id,
      business_name: project.name,
      data: rows.map((r) => this.toListItem(r)),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findOne(id: string) {
    const row = await this.repo.findOne({
      where: [{ paymentId: id }, { orderId: id }],
    });
    if (!row) throw new NotFoundException(`SPEI ${id} no encontrado`);
    return this.toListItem(row);
  }

  /** Tarjetas del dashboard: conteos y montos por grupo (respeta los filtros activos). */
  async stats(q: QuerySpeiDto) {
    const qb = this.repo.createQueryBuilder('s');
    this.applyFilters(qb, { ...q, status: 'all' });
    const rows = await qb.getMany();

    const base = { count: 0, amount: 0 };
    const acc = {
      total:      { ...base },
      pending:    { ...base },
      accredited: { ...base },
      failed:     { ...base },
    };

    for (const r of rows) {
      const grupo = this.groupOf(r.status, r.statusDetail, r.fhExpiracion);
      const amount = Number(r.amount) || 0;
      acc.total.count++;
      acc.total.amount += amount;
      acc[grupo].count++;
      acc[grupo].amount += amount;
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      total:      { count: acc.total.count,      amount: round(acc.total.amount) },
      pending:    { count: acc.pending.count,    amount: round(acc.pending.amount) },
      accredited: { count: acc.accredited.count, amount: round(acc.accredited.amount) },
      failed:     { count: acc.failed.count,     amount: round(acc.failed.amount) },
      tasa_conversion: acc.total.count
        ? round((acc.accredited.count / acc.total.count) * 100)
        : 0,
    };
  }
}
