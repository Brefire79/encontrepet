(function (global) {
  const DEFAULTS = {
    maxHashDistance: 10,
    minGeoDistanceKm: 50,
    recentDays: 30
  };

  function toRad(deg) {
    return deg * (Math.PI / 180);
  }

  function haversineDistanceKm(lat1, lng1, lat2, lng2) {
    if ([lat1, lng1, lat2, lng2].some(v => typeof v !== 'number' || Number.isNaN(v))) {
      return Number.POSITIVE_INFINITY;
    }

    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function normalizeHexHash(hash) {
    return (hash || '').toString().trim().toLowerCase();
  }

  function hammingDistance(hashA, hashB) {
    const a = normalizeHexHash(hashA);
    const b = normalizeHexHash(hashB);

    if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;

    let distance = 0;

    for (let i = 0; i < a.length; i++) {
      const nibbleA = parseInt(a[i], 16);
      const nibbleB = parseInt(b[i], 16);
      if (Number.isNaN(nibbleA) || Number.isNaN(nibbleB)) return Number.POSITIVE_INFINITY;
      let xor = nibbleA ^ nibbleB;
      while (xor) {
        distance += xor & 1;
        xor >>= 1;
      }
    }

    return distance;
  }

  function toTimestamp(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (value?.toMillis) return value.toMillis();
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  function isRecent(value, days = DEFAULTS.recentDays) {
    const timestamp = toTimestamp(value);
    if (!timestamp) return false;
    const minTs = Date.now() - (days * 24 * 60 * 60 * 1000);
    return timestamp >= minTs;
  }

  function findDuplicateCandidates(currentAlert, alerts, options = {}) {
    const maxHashDistance = options.maxHashDistance ?? DEFAULTS.maxHashDistance;
    const minGeoDistanceKm = options.minGeoDistanceKm ?? DEFAULTS.minGeoDistanceKm;
    const recentDays = options.recentDays ?? DEFAULTS.recentDays;

    if (!currentAlert?.imageHash) return [];

    const currentHash = normalizeHexHash(currentAlert.imageHash);

    return (alerts || [])
      .filter(alert => alert?.id && alert.id !== currentAlert.id)
      .filter(alert => alert?.tipo_animal === currentAlert.tipo_animal)
      .filter(alert => isRecent(alert?.created_at || alert?.data_avistamento || alert?.data_perda, recentDays))
      .map(alert => {
        const comparedHash = normalizeHexHash(alert.imageHash || alert.foto_hash);
        const hashDistance = hammingDistance(currentHash, comparedHash);

        const geoDistanceKm = haversineDistanceKm(
          Number(currentAlert.latitude),
          Number(currentAlert.longitude),
          Number(alert.latitude),
          Number(alert.longitude)
        );

        const isDuplicate = hashDistance <= maxHashDistance && geoDistanceKm > minGeoDistanceKm;

        return {
          ...alert,
          comparedHash,
          hashDistance,
          geoDistanceKm,
          isDuplicate
        };
      })
      .filter(alert => Number.isFinite(alert.hashDistance) && Number.isFinite(alert.geoDistanceKm))
      .sort((a, b) => {
        if (a.hashDistance !== b.hashDistance) return a.hashDistance - b.hashDistance;
        return b.geoDistanceKm - a.geoDistanceKm;
      });
  }

  const api = {
    DEFAULTS,
    haversineKm: haversineDistanceKm,
    haversineDistanceKm,
    hammingDistance,
    isRecent,
    toTimestamp,
    findDuplicateCandidates
  };

  global.SimilarityService = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
