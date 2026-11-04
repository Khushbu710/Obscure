import { z } from "zod";
import {
  BlockchainTxStatusSchema,
  ISODateStringSchema,
  OrderStatusSchema,
  ReceiptPayloadSchema,
  ReceiptSchema,
  SafeOrderViewSchema,
  SettlementModeSchema,
} from "@obscura/contracts";

/**
 * Response shapes for the wallet/orders/receipts/security routes
 * (services/api/src/http/routes/{wallet,orders,receipts,security}.ts).
 * These are hand-authored, NOT re-exported from @obscura/contracts, because
 * those routes return plain object literals (PaymentView, ScoreboardRun,
 * etc.) rather than a shared Zod contract - verified by reading the route
 * handlers directly, not assumed from docs/architecture/frontend-integration.md.
 * Reused directly from contracts wherever a real shared schema already
 * covers a piece exactly (SafeOrderView, Receipt, ReceiptPayload,
 * SelectiveDisclosure (imported directly from @obscura/contracts by
 * client.ts), OrderStatus, SettlementMode, BlockchainTxStatus).
 */

export const WalletFundResponseSchema = z.object({
  mandateId: z.string().uuid(),
  envelopeWalletRef: z.string(),
  receivingAddress: z.string(),
});
export type WalletFundResponse = z.infer<typeof WalletFundResponseSchema>;

export const WalletEnvelopeResponseSchema = z.object({
  mandateId: z.string().uuid(),
  receivingAddress: z.string(),
  spendableZatoshi: z.number().int().nonnegative(),
  totalZatoshi: z.number().int().nonnegative(),
  funded: z.boolean(),
  fundingTxId: z.string().nullable(),
});
export type WalletEnvelopeResponse = z.infer<typeof WalletEnvelopeResponseSchema>;

export const WalletSweepResponseSchema = z.object({
  mandateId: z.string().uuid(),
  sweepTxId: z.string(),
  status: BlockchainTxStatusSchema,
});
export type WalletSweepResponse = z.infer<typeof WalletSweepResponseSchema>;

/** Mirrors PaymentView exactly (services/api/src/payment/paymentService.ts) - NOT the unrelated, unused PaymentIntentSchema in contracts. */
export const PaymentViewSchema = z.object({
  orderId: z.string().uuid(),
  status: OrderStatusSchema,
  settlementMode: SettlementModeSchema,
  merchantInvoiceRef: z.string().nullable(),
  txId: z.string().nullable(),
  amountZatoshi: z.number().int().nonnegative().nullable(),
  simulatedDelivery: z.object({ simulated: z.literal(true), label: z.string() }).nullable(),
});
export type PaymentView = z.infer<typeof PaymentViewSchema>;

export const OrderWithPaymentSchema = z.object({
  order: SafeOrderViewSchema,
  payment: PaymentViewSchema.nullable(),
});
export type OrderWithPayment = z.infer<typeof OrderWithPaymentSchema>;

export const OrdersListResponseSchema = z.object({ orders: z.array(OrderWithPaymentSchema) });

export const ReceiptMetadataSchema = z.object({
  receiptId: z.string().uuid(),
  orderId: z.string().uuid(),
  commitment: z.string(),
  createdAt: ISODateStringSchema,
});
export type ReceiptMetadata = z.infer<typeof ReceiptMetadataSchema>;

export const ReceiptListResponseSchema = z.array(ReceiptMetadataSchema);

export const ReceiptDetailResponseSchema = z.object({
  receipt: ReceiptSchema.omit({ encryptedPayload: true }),
  payload: ReceiptPayloadSchema,
  signatureValid: z.boolean(),
});
export type ReceiptDetailResponse = z.infer<typeof ReceiptDetailResponseSchema>;

export const ReceiptPublicKeyResponseSchema = z.object({
  algorithm: z.literal("Ed25519"),
  format: z.literal("SPKI-DER-base64"),
  publicKey: z.string(),
  persistentKeys: z.boolean(),
});
export type ReceiptPublicKeyResponse = z.infer<typeof ReceiptPublicKeyResponseSchema>;

/** Mirrors ScenarioResult / ScoreboardRun exactly (tests/attack-scoreboard/src/runner.ts). */
export const ScoreboardScenarioResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  core: z.boolean(),
  attack: z.string(),
  expectedDefense: z.string(),
  passed: z.boolean(),
  observed: z.string(),
  durationMs: z.number(),
});

export const ScoreboardRunSchema = z.object({
  ranAt: ISODateStringSchema,
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  coreTotal: z.number().int().nonnegative(),
  corePassed: z.number().int().nonnegative(),
  results: z.array(ScoreboardScenarioResultSchema),
});
export type ScoreboardRun = z.infer<typeof ScoreboardRunSchema>;

export const ScoreboardResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_run"), message: z.string() }),
  z.object({ status: z.literal("ok"), run: ScoreboardRunSchema }),
]);
export type ScoreboardResponse = z.infer<typeof ScoreboardResponseSchema>;
