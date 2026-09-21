import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Tabla propia de este proyecto dentro de MercadoPagoBD.
 * No se reutiliza `Payments` (compartida con mercadopago-nest) porque esa tabla
 * no guarda CLABE, banco ni fecha de expiración, que es justo lo que necesita el dashboard.
 * La tabla se crea sola al arrancar — ver SpeiService.ensureSchema().
 */
@Entity('SpeiPayments')
@Unique('UK_Spei_PaymentId', ['paymentId'])
@Index('IDX_Spei_OrderId', ['orderId'])
@Index('IDX_Spei_Status', ['status'])
@Index('IDX_Spei_ExternalReference', ['externalReference'])
export class SpeiPayment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, name: 'Id' })
  id: number;

  @Column({ type: 'varchar', length: 50, name: 'OrderId' })
  orderId: string;

  @Column({ type: 'varchar', length: 50, name: 'PaymentId' })
  paymentId: string;

  @Column({ type: 'varchar', length: 30, name: 'Status' })
  status: string;

  @Column({ type: 'varchar', length: 60, nullable: true, name: 'StatusDetail' })
  statusDetail: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true, name: 'Clabe' })
  clabe: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true, name: 'Referencia' })
  referencia: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true, name: 'Banco' })
  banco: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'Amount' })
  amount: number;

  @Column({ type: 'varchar', length: 5, default: 'MXN', name: 'Currency' })
  currency: string;

  @Column({ type: 'varchar', length: 150, nullable: true, name: 'PayerEmail' })
  payerEmail: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'Description' })
  description: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'ExternalReference' })
  externalReference: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'TicketUrl' })
  ticketUrl: string | null;

  @Column({ type: 'datetime', nullable: true, name: 'FhExpiracion' })
  fhExpiracion: Date | null;

  @Column({ type: 'datetime', nullable: true, name: 'FhAcreditacion' })
  fhAcreditacion: Date | null;

  @Column({ type: 'boolean', default: false, name: 'Notified' })
  notified: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'FhRegistro' })
  fhRegistro: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'FhActualizacion' })
  fhActualizacion: Date;

  /** Nombre de la empresa a la que pertenece el SPEI. */
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'BusinessName' })
  businessName: string | null;

  /** FK lógica al Project (empresa). */
  @Column({ type: 'bigint', nullable: true, name: 'IdProject' })
  idProject: number | null;
}
