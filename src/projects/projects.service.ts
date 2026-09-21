import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  private generateApiKey(): string {
    return randomBytes(32).toString('hex');
  }

  private async ensureSchema() {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS Projects (
          Id          BIGINT       NOT NULL AUTO_INCREMENT,
          Name        VARCHAR(100) NULL,
          Estatus     TINYINT      NULL DEFAULT 1,
          FHRegistro  DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
          \`Key\`     TEXT         NULL,
          WebhookUrl  VARCHAR(500) NULL,
          PRIMARY KEY (Id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      const cols = await this.dataSource.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Projects' AND COLUMN_NAME = 'Key'`,
      );
      if (Number(cols[0]?.c) === 0) {
        await this.dataSource.query(
          'ALTER TABLE Projects ADD COLUMN `Key` TEXT NULL AFTER FHRegistro',
        );
        this.logger.log('DB ✅ Columna Projects.Key agregada');
      }

      const whCols = await this.dataSource.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Projects' AND COLUMN_NAME = 'WebhookUrl'`,
      );
      if (Number(whCols[0]?.c) === 0) {
        await this.dataSource.query(
          'ALTER TABLE Projects ADD COLUMN WebhookUrl VARCHAR(500) NULL AFTER `Key`',
        );
        this.logger.log('DB ✅ Columna Projects.WebhookUrl agregada');
      }

      // Backfill de keys faltantes
      const missing = await this.repo
        .createQueryBuilder('p')
        .where('p.`Key` IS NULL OR p.`Key` = :empty', { empty: '' })
        .getMany();
      for (const row of missing) {
        row.key = this.generateApiKey();
        await this.repo.save(row);
      }
      if (missing.length) {
        this.logger.log(`DB ✅ ApiKey generada para ${missing.length} empresa(s)`);
      }

      this.logger.log('DB ✅ Tabla Projects lista');
    } catch (err) {
      this.logger.error(`DB ❌ No se pudo verificar/crear Projects: ${err.message}`);
    }
  }

  private normalizeWebhookUrl(value?: string | null): string | null {
    if (value == null) return null;
    const url = String(value).trim();
    return url || null;
  }

  private toItem(p: Project) {
    return {
      id: Number(p.id),
      name: p.name,
      estatus: p.estatus == null ? 1 : Number(p.estatus),
      fh_registro: p.fhRegistro,
      key: p.key,
      webhook_url: p.webhookUrl ?? null,
    };
  }

  async list() {
    const rows = await this.repo.find({ order: { fhRegistro: 'DESC' } });
    return rows.map((r) => this.toItem(r));
  }

  /** Solo empresas activas (para el select al generar SPEI). */
  async listActive() {
    const rows = await this.repo.find({
      where: { estatus: 1 },
      order: { name: 'ASC' },
    });
    return rows.map((r) => this.toItem(r));
  }

  async findOne(id: number) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Proyecto ${id} no encontrado`);
    return this.toItem(row);
  }

  /**
   * Resuelve un proyecto activo por su ApiKey (header).
   * Devuelve el nombre a usar como business_name del SPEI.
   */
  async resolveByApiKey(apiKey: string): Promise<{ id: number; name: string }> {
    const key = apiKey?.trim();
    if (!key) throw new UnauthorizedException('Header ApiKey es obligatorio');

    const row = await this.repo
      .createQueryBuilder('p')
      .where('p.`Key` = :key', { key })
      .getOne();

    if (!row) throw new UnauthorizedException('ApiKey inválida');
    if (Number(row.estatus) !== 1) {
      throw new UnauthorizedException('El proyecto asociado a esta ApiKey está inactivo');
    }
    if (!row.name?.trim()) {
      throw new BadRequestException('El proyecto no tiene nombre configurado');
    }

    return { id: Number(row.id), name: row.name.trim() };
  }

  /** Resuelve un proyecto activo por nombre (dashboard / business_name). */
  async resolveByName(name: string): Promise<{ id: number; name: string }> {
    const n = name?.trim();
    if (!n) throw new BadRequestException('El nombre del proyecto es obligatorio');

    const row = await this.repo.findOne({ where: { name: n, estatus: 1 } });
    if (!row) {
      throw new BadRequestException(`Proyecto activo no encontrado: ${n}`);
    }
    return { id: Number(row.id), name: row.name!.trim() };
  }

  async create(dto: CreateProjectDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio');

    const row = this.repo.create({
      name,
      estatus: 1,
      key: this.generateApiKey(),
      webhookUrl: this.normalizeWebhookUrl(dto.webhook_url),
    });
    const saved = await this.repo.save(row);
    this.logger.log(`Proyecto creado #${saved.id}: ${saved.name}`);
    return this.toItem(saved);
  }

  async update(id: number, dto: UpdateProjectDto) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Proyecto ${id} no encontrado`);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('El nombre es obligatorio');
      row.name = name;
    }
    if (dto.estatus !== undefined) row.estatus = dto.estatus;
    if (dto.webhook_url !== undefined) {
      row.webhookUrl = this.normalizeWebhookUrl(dto.webhook_url);
    }

    const saved = await this.repo.save(row);
    return this.toItem(saved);
  }

  /** URL de callback del proyecto para notificar acreditaciones SPEI. */
  async getWebhookUrl(id: number): Promise<string | null> {
    const row = await this.repo.findOne({ where: { id } });
    return this.normalizeWebhookUrl(row?.webhookUrl);
  }

  async regenerateKey(id: number) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Proyecto ${id} no encontrado`);
    row.key = this.generateApiKey();
    const saved = await this.repo.save(row);
    this.logger.log(`ApiKey regenerada para proyecto #${saved.id}`);
    return this.toItem(saved);
  }

  async remove(id: number) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Proyecto ${id} no encontrado`);
    await this.repo.remove(row);
    return { deleted: true, id };
  }
}
