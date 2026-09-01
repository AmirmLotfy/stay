export function log(
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'stay-local',
    message,
    ...fields,
  };
  if (level === 'ERROR') console.error(JSON.stringify(record));
  else if (level === 'WARN') console.warn(JSON.stringify(record));
  else console.info(JSON.stringify(record));
}
