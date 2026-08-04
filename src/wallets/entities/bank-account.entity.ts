import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  bankName: string;

  @Column()
  bankCode: string;

  @Column()
  accountNumber: string;

  // The bank's own record of the account holder's name, from
  // PaystackService.resolveAccountNumber() — never a self-reported
  // value, so a withdrawal can't be silently misdirected.
  @Column()
  accountName: string;

  // Needed for every actual transfer — created once via
  // PaystackService.createTransferRecipient() when the account is added.
  @Column()
  paystackRecipientCode: string;

  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
