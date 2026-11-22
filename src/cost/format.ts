/** Two decimals at least, up to six, without trailing zeros: 1.5 is `$1.50`, 0.0042 stays `$0.0042`. */
export function formatUsd(value: number): string {
  const trimmed = value.toFixed(6).replace(/0+$/, '');
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return `$${whole}.${fraction.padEnd(2, '0')}`;
}
