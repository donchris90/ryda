import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LedgerAuditService } from './ledger-audit.service';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletTransaction } from '../wallets/entities/wallet-transaction.entity';
import { TransactionDirection, TransactionCategory } from '../common/enums/transaction.enum';
import { LedgerDiscrepancyStatus, LedgerAccountType } from './entities/ledger-discrepancy.entity';

function fakeWallet(overrides: Partial<Wallet> = {}): Wallet {
  return { id: 'wallet-1', userId: 'user-1', balance: '700.00', currency: 'NGN', isFrozen: false, createdAt: new Date(), updatedAt: new Date(), ...overrides } as Wallet;
}

function fakeTx(overrides: Partial<WalletTransaction> = {}): WalletTransaction {
  return {
    id: 'tx-1',
    walletId: 'wallet-1',
    direction: TransactionDirection.CREDIT,
    category: TransactionCategory.TOPUP,
    amount: '100.00',
    balanceAfter: '100.00',
    referenceId: null,
    description: null,
    createdAt: new Date(),
    ...overrides,
  } as WalletTransaction;
}

function build(wallet: Wallet | null, transactions: WalletTransaction[]) {
  const walletsRepo = {
    findOne: jest.fn().mockResolvedValue(wallet),
    count: jest.fn().mockResolvedValue(1),
    manager: { query: jest.fn().mockResolvedValue([]) },
  } as any;
  const txRepo = { find: jest.fn().mockResolvedValue(transactions) } as any;
  const fleetWalletsRepo = { manager: { query: jest.fn().mockResolvedValue([]) } } as any;
  const fleetTxRepo = { find: jest.fn().mockResolvedValue([]) } as any;
  const corporateAccountsRepo = { manager: { query: jest.fn().mockResolvedValue([]) } } as any;
  const corporateTxRepo = { find: jest.fn().mockResolvedValue([]) } as any;

  let savedDiscrepancy: any = null;
  const discrepancyRepo = {
    findOne: jest.fn().mockResolvedValue(savedDiscrepancy),
    save: jest.fn(async (d: any) => {
      savedDiscrepancy = { id: 'discrepancy-1', ...d };
      return savedDiscrepancy;
    }),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
  } as any;

  const service = new LedgerAuditService(
    walletsRepo,
    txRepo,
    fleetWalletsRepo,
    fleetTxRepo,
    corporateAccountsRepo,
    corporateTxRepo,
    discrepancyRepo,
  );
  return { service, walletsRepo, txRepo, discrepancyRepo };
}

describe('LedgerAuditService', () => {
  describe('checkWalletChain()', () => {
    it('a genuinely consistent wallet (matching a real WalletsService.credit()/debit() history) passes cleanly', async () => {
      const wallet = fakeWallet({ balance: '700.00' });
      const transactions = [
        fakeTx({ id: 'tx-1', direction: TransactionDirection.CREDIT, amount: '500.00', balanceAfter: '500.00' }),
        fakeTx({ id: 'tx-2', direction: TransactionDirection.CREDIT, amount: '300.00', balanceAfter: '800.00' }),
        fakeTx({ id: 'tx-3', direction: TransactionDirection.DEBIT, amount: '100.00', balanceAfter: '700.00' }),
      ];
      const { service } = build(wallet, transactions);

      const result = await service.checkWalletChain('wallet-1');

      expect(result.ok).toBe(true);
      expect(result.computedBalance).toBe('700.00');
      expect(result.brokenAt).toBeNull();
    });

    it('a wallet with no transactions at all and a genuine zero balance passes cleanly', async () => {
      const wallet = fakeWallet({ balance: '0.00' });
      const { service } = build(wallet, []);

      const result = await service.checkWalletChain('wallet-1');

      expect(result.ok).toBe(true);
      expect(result.computedBalance).toBe('0.00');
    });

    it('detects a break in the middle of the chain - one transaction row with a balanceAfter that does not match what the running total should be at that point', async () => {
      const wallet = fakeWallet({ balance: '9999.00' });
      const transactions = [
        fakeTx({ id: 'tx-1', direction: TransactionDirection.CREDIT, amount: '500.00', balanceAfter: '500.00' }),
        // Tampered row: should be 800.00 (500 + 300), but says 9999.00.
        fakeTx({ id: 'tx-2', direction: TransactionDirection.CREDIT, amount: '300.00', balanceAfter: '9999.00' }),
        fakeTx({ id: 'tx-3', direction: TransactionDirection.DEBIT, amount: '100.00', balanceAfter: '9899.00' }),
      ];
      const { service } = build(wallet, transactions);

      const result = await service.checkWalletChain('wallet-1');

      expect(result.ok).toBe(false);
      expect(result.brokenAt).not.toBeNull();
      expect(result.brokenAt!.transactionId).toBe('tx-2');
      expect(result.brokenAt!.expectedBalanceAfter).toBe('800.00');
      expect(result.brokenAt!.actualBalanceAfter).toBe('9999.00');
    });

    it('detects a wallet whose final balance does not match its own consistent, unbroken chain - e.g. a direct SQL edit bypassing WalletsService entirely', async () => {
      const wallet = fakeWallet({ balance: '99999.99' }); // corrupted directly, not via the service
      const transactions = [
        fakeTx({ id: 'tx-1', direction: TransactionDirection.CREDIT, amount: '700.00', balanceAfter: '700.00' }),
      ];
      const { service } = build(wallet, transactions);

      const result = await service.checkWalletChain('wallet-1');

      expect(result.ok).toBe(false);
      expect(result.computedBalance).toBe('700.00');
      expect(result.walletBalance).toBe('99999.99');
      expect(result.brokenAt).toBeNull(); // the chain itself is fine - only the final wallet.balance is wrong
    });

    it('throws for a wallet that does not exist', async () => {
      const { service } = build(null, []);

      await expect(service.checkWalletChain('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolve()', () => {
    it('marks an open discrepancy resolved with the admin and note recorded', async () => {
      const discrepancyRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'discrepancy-1',
          walletId: 'wallet-1',
          status: LedgerDiscrepancyStatus.OPEN,
        }),
        save: jest.fn(async (d: any) => d),
      } as any;
      const service = new LedgerAuditService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, discrepancyRepo);

      const result = await service.resolve('discrepancy-1', 'admin-1', 'Investigated, corrected manually');

      expect(result.status).toBe(LedgerDiscrepancyStatus.RESOLVED);
      expect(result.resolvedBy).toBe('admin-1');
      expect(result.resolutionNote).toBe('Investigated, corrected manually');
      expect(result.resolvedAt).toBeInstanceOf(Date);
    });

    it('rejects resolving something already resolved', async () => {
      const discrepancyRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'discrepancy-1', status: LedgerDiscrepancyStatus.RESOLVED }),
        save: jest.fn(),
      } as any;
      const service = new LedgerAuditService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, discrepancyRepo);

      await expect(service.resolve('discrepancy-1', 'admin-1', 'note')).rejects.toThrow(BadRequestException);
      expect(discrepancyRepo.save).not.toHaveBeenCalled();
    });

    it('throws for a discrepancy that does not exist', async () => {
      const discrepancyRepo = { findOne: jest.fn().mockResolvedValue(null) } as any;
      const service = new LedgerAuditService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, discrepancyRepo);

      await expect(service.resolve('nonexistent', 'admin-1', 'note')).rejects.toThrow(NotFoundException);
    });
  });

  describe('fleet wallet and corporate account coverage - extending discrepancy detection beyond passenger/driver wallets', () => {
    it('runFleetWalletScan() queries the fleet_wallets/fleet_transactions tables specifically, and correctly flags a genuine discrepancy there', async () => {
      const fleetWalletsRepo = {
        manager: {
          query: jest
            .fn()
            .mockResolvedValueOnce([{ count: 1 }])
            .mockResolvedValueOnce([{ walletId: 'fleet-wallet-1', walletBalance: '500.00', ledgerBalance: '300.00' }]),
        },
      } as any;
      const discrepancyRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(async (d: any) => ({ id: 'discrepancy-1', ...d })),
        create: jest.fn((d: any) => d),
      } as any;
      const service = new LedgerAuditService(
        {} as any, {} as any, fleetWalletsRepo, {} as any, {} as any, {} as any, discrepancyRepo,
      );

      const result = await service.runFleetWalletScan();

      expect(result.walletsScanned).toBe(1);
      expect(result.newDiscrepancies).toHaveLength(1);
      expect(discrepancyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ accountType: LedgerAccountType.FLEET_WALLET, walletId: 'fleet-wallet-1' }),
      );
      // Confirms the fleet-specific table names were genuinely used, not the wallet ones.
      const queryCalls = fleetWalletsRepo.manager.query.mock.calls;
      expect(queryCalls[1][0]).toContain('fleet_wallets');
      expect(queryCalls[1][0]).toContain('fleet_transactions');
    });

    it('runCorporateAccountScan() queries corporate_accounts/corporate_transactions using the budgetBalance column specifically, and correctly flags a genuine discrepancy', async () => {
      const corporateAccountsRepo = {
        manager: {
          query: jest
            .fn()
            .mockResolvedValueOnce([{ count: 1 }])
            .mockResolvedValueOnce([{ walletId: 'corp-account-1', walletBalance: '10000.00', ledgerBalance: '9000.00' }]),
        },
      } as any;
      const discrepancyRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(async (d: any) => ({ id: 'discrepancy-1', ...d })),
        create: jest.fn((d: any) => d),
      } as any;
      const service = new LedgerAuditService(
        {} as any, {} as any, {} as any, {} as any, corporateAccountsRepo, {} as any, discrepancyRepo,
      );

      const result = await service.runCorporateAccountScan();

      expect(result.newDiscrepancies).toHaveLength(1);
      expect(discrepancyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ accountType: LedgerAccountType.CORPORATE_ACCOUNT, walletId: 'corp-account-1' }),
      );
      const queryCalls = corporateAccountsRepo.manager.query.mock.calls;
      expect(queryCalls[1][0]).toContain('corporate_accounts');
      expect(queryCalls[1][0]).toContain('budgetBalance');
    });

    it('a genuinely consistent fleet wallet produces no discrepancy', async () => {
      const fleetWalletsRepo = {
        manager: {
          query: jest.fn().mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([]),
        },
      } as any;
      const discrepancyRepo = { save: jest.fn() } as any;
      const service = new LedgerAuditService(
        {} as any, {} as any, fleetWalletsRepo, {} as any, {} as any, {} as any, discrepancyRepo,
      );

      const result = await service.runFleetWalletScan();

      expect(result.newDiscrepancies).toHaveLength(0);
      expect(discrepancyRepo.save).not.toHaveBeenCalled();
    });

    it('checkWalletChain() with accountType FLEET_WALLET walks fleet_transactions and reads the correct balance field', async () => {
      const fleetWallet = { id: 'fleet-wallet-1', balance: '200.00' };
      const fleetWalletsRepo = { findOne: jest.fn().mockResolvedValue(fleetWallet) } as any;
      const fleetTxRepo = {
        find: jest.fn().mockResolvedValue([
          { id: 'tx-1', direction: TransactionDirection.CREDIT, amount: '200.00', balanceAfter: '200.00' },
        ]),
      } as any;
      const service = new LedgerAuditService(
        {} as any, {} as any, fleetWalletsRepo, fleetTxRepo, {} as any, {} as any, {} as any,
      );

      const result = await service.checkWalletChain('fleet-wallet-1', LedgerAccountType.FLEET_WALLET);

      expect(result.ok).toBe(true);
      expect(result.accountType).toBe(LedgerAccountType.FLEET_WALLET);
      expect(fleetTxRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fleetWalletId: 'fleet-wallet-1' } }),
      );
    });

    it('checkWalletChain() with accountType CORPORATE_ACCOUNT reads budgetBalance, not balance', async () => {
      const corporateAccount = { id: 'corp-1', budgetBalance: '1000.00' };
      const corporateAccountsRepo = { findOne: jest.fn().mockResolvedValue(corporateAccount) } as any;
      const corporateTxRepo = {
        find: jest.fn().mockResolvedValue([
          { id: 'tx-1', direction: TransactionDirection.CREDIT, amount: '1000.00', balanceAfter: '1000.00' },
        ]),
      } as any;
      const service = new LedgerAuditService(
        {} as any, {} as any, {} as any, {} as any, corporateAccountsRepo, corporateTxRepo, {} as any,
      );

      const result = await service.checkWalletChain('corp-1', LedgerAccountType.CORPORATE_ACCOUNT);

      expect(result.ok).toBe(true);
      expect(result.walletBalance).toBe('1000.00');
      expect(corporateTxRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { corporateAccountId: 'corp-1' } }),
      );
    });
  });
});
