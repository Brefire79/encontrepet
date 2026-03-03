export function hammingDistance(hashA: string, hashB: string): number {
  const a = (hashA || '').trim().toLowerCase();
  const b = (hashB || '').trim().toLowerCase();
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;

  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const nibbleA = Number.parseInt(a[i], 16);
    const nibbleB = Number.parseInt(b[i], 16);
    if (Number.isNaN(nibbleA) || Number.isNaN(nibbleB)) return Number.POSITIVE_INFINITY;
    let xor = nibbleA ^ nibbleB;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if ([lat1, lng1, lat2, lng2].some(v => typeof v !== 'number' || Number.isNaN(v))) {
    return Number.POSITIVE_INFINITY;
  }

  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
