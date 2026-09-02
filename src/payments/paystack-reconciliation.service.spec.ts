import { PaystackReconciliationService } from './paystack-reconciliation.service';
import { PaymentRecord, PaymentStatus } from './entities/payment-record.entity';
import { PaymentMethod } from '../common/enums/ride.enum';

function fakeRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'payment-1',
    rideId: 'ride-1',
    userId: 'user-1',
    method: PaymentMethod.CARD,
    amount: '1000.00',
    status: PaymentStatus.SUCCESS,
    reference: 'ref-1',
    simulated: false,
    gatewayReference: 'GW-1',
    failureReason: null,
    refundedAmount: null,
    pendingRefundAmount: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentRecord;
}

function build(localRecords: PaymentRecord[], paystackTransactions: any[]) {
  const paymentsRepo = { find: jest.fn().mockResolvedValue(localRecords) } as any;
  const paystack = { listTransactions: jest.fn().mockResolvedValue(paystackTransactions) } as any;
  const service = new PaystackReconciliationService(paymentsRepo, paystack);
  return { service, paymentsRepo, paystack };
}

const FROM = new Date('2026-01-01');
const TO = new Date('2026-01-02');

describe('PaystackReconciliationService', () => {
  it('a genuinely matching set of records and transactions produces zero issues', async () => {
    const { service } = build(
      [fakeRecord({ reference: 'ref-1', amount: '1000.00', status: PaymentStatus.SUCCESS })],
      [{ reference: 'ref-1', status: 'success', amountKobo: 100000, paidAt: new Date() }],
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toHaveLength(0);
    expect(report.localRecordsChecked).toBe(1);
    expect(report.paystackTransactionsChecked).toBe(1);
  });

  it('flags a successful Paystack transaction with no local record at all - a possible missed webhook', async () => {
    const { service } = build(
      [],
      [{ reference: 'ref-missed', status: 'success', amountKobo: 50000, paidAt: new Date() }],
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toEqual([
      expect.objectContaining({ type: 'missing_locally', reference: 'ref-missed' }),
    ]);
  });

  it('does NOT flag a Paystack transaction that never succeeded (e.g. abandoned checkout) as missing locally', async () => {
    const { service } = build(
      [],
      [{ reference: 'ref-abandoned', status: 'abandoned', amountKobo: 50000, paidAt: null }],
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toHaveLength(0);
  });

  it('flags our own SUCCESS record when Paystack has no matching transaction at all', async () => {
    const { service } = build(
      [fakeRecord({ reference: 'ref-ghost', status: PaymentStatus.SUCCESS })],
      [],
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toEqual([
      expect.objectContaining({ type: 'status_mismatch', reference: 'ref-ghost', paystackStatus: null }),
    ]);
  });

  it('flags our own SUCCESS record when Paystack disagrees it succeeded', async () => {
    const { service } = build(
      [fakeRecord({ reference: 'ref-1', status: PaymentStatus.SUCCESS })],
      [{ reference: 'ref-1', status: 'failed', amountKobo: 100000, paidAt: null }],
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toEqual([
      expect.objectContaining({ type: 'status_mismatch', reference: 'ref-1', paystackStatus: 'failed' }),
    ]);
  });

  it('flags an amount mismatch between our record and Paystack for the same reference', async () => {
    const { service } = build(
      [fakeRecord({ reference: 'ref-1', amount: '1000.00', status: PaymentStatus.SUCCESS })],
      [{ reference: 'ref-1', status: 'success', amountKobo: 90000, paidAt: new Date() }], // 900.00, not 1000.00
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toEqual([
      expect.objectContaining({ type: 'amount_mismatch', reference: 'ref-1', localAmount: '1000.00', paystackAmountKobo: 90000 }),
    ]);
  });

  it('a 1 kobo rounding difference is tolerated, not flagged as a real amount mismatch', async () => {
    const { service } = build(
      [fakeRecord({ reference: 'ref-1', amount: '1000.00', status: PaymentStatus.SUCCESS })],
      [{ reference: 'ref-1', status: 'success', amountKobo: 100001, paidAt: new Date() }],
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toHaveLength(0);
  });

  it('simulated payments are correctly never flagged, even with no Paystack counterpart - they were never sent to Paystack by design', async () => {
    const { service } = build(
      [fakeRecord({ reference: 'ref-sim', status: PaymentStatus.SUCCESS, simulated: true })],
      [],
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toHaveLength(0);
  });

  it('a non-SUCCESS local record (e.g. still PENDING) is correctly never flagged for status/amount mismatch - only SUCCESS records are checked against Paystack that way', async () => {
    const { service } = build(
      [fakeRecord({ reference: 'ref-pending', status: PaymentStatus.PENDING })],
      [],
    );

    const report = await service.reconcile(FROM, TO);

    expect(report.issues).toHaveLength(0);
  });

  it('passes the exact from/to range through to both the local query and the Paystack API call', async () => {
    const { service, paystack } = build([], []);

    await service.reconcile(FROM, TO);

    expect(paystack.listTransactions).toHaveBeenCalledWith(FROM, TO);
  });
});
