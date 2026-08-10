export enum TransactionDirection {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum TransactionCategory {
  RIDE_PAYMENT = 'ride_payment', // passenger paying for a ride from wallet
  RIDE_EARNING = 'ride_earning', // driver earning after commission
  COMMISSION = 'commission', // platform commission taken from a ride
  TOPUP = 'topup',
  WITHDRAWAL = 'withdrawal',
  REFUND = 'refund',
  BONUS = 'bonus',
  CASHBACK = 'cashback',
  REFERRAL = 'referral',
  CANCELLATION_FEE = 'cancellation_fee',
  DELIVERY_PAYMENT = 'delivery_payment',
  DELIVERY_EARNING = 'delivery_earning',
  SPLIT_FARE_PAYMENT = 'split_fare_payment', // a participant paying their share
  SPLIT_FARE_RECEIVED = 'split_fare_received', // the initiator receiving a participant's share
  TIP_PAYMENT = 'tip_payment', // passenger tipping their driver
  TIP_RECEIVED = 'tip_received',
  TRANSFER_SENT = 'transfer_sent',
  TRANSFER_RECEIVED = 'transfer_received', // driver receiving a tip
}
