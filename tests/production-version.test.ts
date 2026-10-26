import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productionJobKey,
  currentArtifact,
  PIPELINE_VERSION,
} from "../lib/production-version";
test("identical production requests dedupe but a changed engine must not return old renders", () => {
  assert.equal(
    productionJobKey("project", 3, "sample"),
    productionJobKey("project", 3, "sample"),
  );
  assert.notEqual(
    productionJobKey("project", 3, "sample"),
    productionJobKey("project", 3, "sample", undefined, "old-engine"),
  );
  assert.notEqual(
    productionJobKey("project", 3, "sample"),
    productionJobKey("project", 3, "render"),
  );
  assert.ok(!currentArtifact(undefined));
  assert.ok(!currentArtifact({}));
  assert.ok(!currentArtifact({ pipelineVersion: "old-engine" }));
  assert.ok(currentArtifact({ pipelineVersion: PIPELINE_VERSION }));
});
