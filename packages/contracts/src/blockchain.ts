import { z } from "zod";

/**
 * The Zcash wrapper service's own contract (owned by Developer 1), included
 * here only because the signer calls it. Do not add fields Developer 1
 * hasn't agreed to without raising it explicitly - see
 * docs/architecture/zcash-integration.md §3.
 */
export const BlockchainTxRequestSchema = z.object({
  walletRef: z.string(),
  outputs: z.array(z.object({ address: z.string(), amountZatoshi: z.number().int().positive() })).min(1),
  memo: z.string().nullable(),
});
export type BlockchainTxRequest = z.infer<typeof BlockchainTxRequestSchema>;

export const BlockchainTxStatusSchema = z.enum(["pending", "broadcast", "mined", "confirmed", "failed"]);
export type BlockchainTxStatus = z.infer<typeof BlockchainTxStatusSchema>;

export const BlockchainTxResultSchema = z.object({
  txId: z.string(),
  status: BlockchainTxStatusSchema,
  confirmations: z.number().int().nonnegative().optional(),
});
export type BlockchainTxResult = z.infer<typeof BlockchainTxResultSchema>;
