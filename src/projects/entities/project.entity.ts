import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('Projects')
export class Project {
  @PrimaryGeneratedColumn({ type: 'bigint', name: 'Id' })
  id: number;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'Name' })
  name: string | null;

  /** 1 = activo, 0 = inactivo */
  @Column({ type: 'tinyint', nullable: true, name: 'Estatus', default: 1 })
  estatus: number | null;

  @CreateDateColumn({ type: 'datetime', name: 'FHRegistro' })
  fhRegistro: Date;

  /** API key (hash) para integrar desde otros sistemas vía header ApiKey. */
  @Column({ type: 'text', nullable: true, name: 'Key' })
  key: string | null;
}
