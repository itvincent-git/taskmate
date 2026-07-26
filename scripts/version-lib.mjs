export function parseVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  return value.split(".").map(Number);
}

export function nextVersion(currentValue, targetValue) {
  const current = parseVersion(currentValue);
  if (!current) throw new Error(`Invalid current version "${currentValue}".`);
  let target;
  if (targetValue === "major") target = [current[0] + 1, 0, 0];
  else if (targetValue === "minor") target = [current[0], current[1] + 1, 0];
  else if (targetValue === "patch") target = [current[0], current[1], current[2] + 1];
  else target = parseVersion(targetValue);
  if (!target) throw new Error("Use major, minor, patch, or a stable x.y.z version.");
  const comparison = target[0] - current[0] || target[1] - current[1] || target[2] - current[2];
  if (comparison <= 0) {
    throw new Error("Target version must be greater than the current version.");
  }
  return target.join(".");
}
