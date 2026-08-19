/**
 * Public Proposal owns routing and read-only packet preparation only.
 * Canonical project mutations are exported by @longtable/kpp-core.
 */
export {
  POSITIVE_PROPOSAL_DOCTRINE,
  buildAgentPacket,
  mergeApprovedPatch,
  type AgentPacket,
  type BuildAgentPacketInput,
  type MergeApprovedPatchOptions,
  type PatchProposal,
  type SecurityClass,
} from "@longtable/kpp-core";
