/** Bump whenever planning, framing, audio or export acceptance changes. */
export const PIPELINE_VERSION = "reviewed-scene-v1";
export function productionJobKey(
  projectId: string,
  revision: number,
  kind: string,
  shotId?: string,
  version = PIPELINE_VERSION,
) {
  return `${version}:${projectId}:${revision}:${kind}:${shotId ?? "all"}`;
}
export function currentArtifact(artifact?: { pipelineVersion?: string }) {
  return artifact?.pipelineVersion === PIPELINE_VERSION;
}
