/**
 * Encontre Pet - Geolocation Utilities
 * Geolocalização, cálculo de distância e raio de busca
 */

const GeoUtils = (() => {

  // Raios de busca por tipo de animal (em km)
  const RAIO_BUSCA = {
    cao: 5,
    gato: 2,
    outro: 3
  };

  // Cache da localização do usuário
  let userLocation = null;

  /**
   * Obtém a localização atual do usuário
   * Retorna: { lat, lng, accuracy }
   */
  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalização não suportada neste dispositivo.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          };
          userLocation = location;
          // Salvar no localStorage
          localStorage.setItem('encontrePet_lastLocation', JSON.stringify(location));
          resolve(location);
        },
        (error) => {
          let msg;
          switch (error.code) {
            case error.PERMISSION_DENIED:
              msg = 'Permissão de localização negada. Ative no navegador.';
              break;
            case error.POSITION_UNAVAILABLE:
              msg = 'Localização indisponível. Tente novamente.';
              break;
            case error.TIMEOUT:
              msg = 'Tempo esgotado. Verifique seu GPS.';
              break;
            default:
              msg = 'Erro ao obter localização.';
          }
          reject(new Error(msg));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000
        }
      );
    });
  }

  /**
   * Retorna a última localização conhecida (cache ou localStorage)
   */
  function getLastLocation() {
    if (userLocation) return userLocation;
    const saved = localStorage.getItem('encontrePet_lastLocation');
    if (saved) {
      userLocation = JSON.parse(saved);
      return userLocation;
    }
    return null;
  }

  /**
   * Calcula a distância entre dois pontos usando fórmula de Haversine
   * Retorna distância em km
   */
  function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Raio da Terra em km
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function toRad(deg) {
    return deg * (Math.PI / 180);
  }

  /**
   * Verifica se um ponto está dentro do raio de busca
   */
  function isWithinRadius(centerLat, centerLng, pointLat, pointLng, radiusKm) {
    const distance = calculateDistance(centerLat, centerLng, pointLat, pointLng);
    return distance <= radiusKm;
  }

  /**
   * Retorna o raio de busca para um tipo de animal
   */
  function getSearchRadius(tipoAnimal) {
    return RAIO_BUSCA[tipoAnimal] || RAIO_BUSCA.outro;
  }

  /**
   * Filtra pets por proximidade à localização do usuário
   * Retorna array de pets dentro do raio, com distância calculada
   */
  function filterByProximity(pets, userLat, userLng, maxRadiusKm = 10) {
    return pets
      .filter(pet => pet.latitude && pet.longitude)
      .map(pet => {
        const distance = calculateDistance(userLat, userLng, pet.latitude, pet.longitude);
        return { ...pet, distance };
      })
      .filter(pet => pet.distance <= maxRadiusKm)
      .sort((a, b) => a.distance - b.distance);
  }

  /**
   * Filtra pets que estão dentro do raio de alerta do pet perdido
   * (para notificar pessoas próximas)
   */
  function findUsersInAlertRadius(petLat, petLng, tipoAnimal, usersLocations) {
    const radius = getSearchRadius(tipoAnimal);
    return usersLocations.filter(user => 
      isWithinRadius(petLat, petLng, user.lat, user.lng, radius)
    );
  }

  /**
   * Formata distância para exibição
   */
  function formatDistance(distanceKm) {
    if (distanceKm < 0.1) return 'Muito perto';
    if (distanceKm < 1) return Math.round(distanceKm * 1000) + ' m';
    return distanceKm.toFixed(1) + ' km';
  }

  /**
   * Geocoding reverso usando API gratuita (Nominatim/OSM)
   * Retorna endereço aproximado a partir de coordenadas
   */
  async function reverseGeocode(lat, lng) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
        {
          headers: {
            'Accept-Language': 'pt-BR'
          }
        }
      );
      
      if (!response.ok) throw new Error('Erro no geocoding');
      
      const data = await response.json();
      
      if (data && data.address) {
        const addr = data.address;
        const parts = [];
        
        if (addr.road) parts.push(addr.road);
        if (addr.suburb) parts.push(addr.suburb);
        if (addr.city || addr.town || addr.village) {
          parts.push(addr.city || addr.town || addr.village);
        }
        if (addr.state) parts.push(addr.state);
        
        return parts.join(', ') || data.display_name;
      }
      
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (err) {
      console.warn('Geocoding reverso falhou:', err);
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  }

  /**
   * Gera URL do mapa estático (OpenStreetMap)
   */
  function getMapUrl(lat, lng, zoom = 15) {
    return `https://www.openstreetmap.org/#map=${zoom}/${lat}/${lng}`;
  }

  /**
   * Verifica se dois pets estão na mesma região (para matching)
   */
  function arePetsInSameRegion(pet1, pet2) {
    if (!pet1.latitude || !pet2.latitude) return true; // Se não tem localização, considera mesmo
    const distance = calculateDistance(pet1.latitude, pet1.longitude, pet2.latitude, pet2.longitude);
    const maxRadius = Math.max(
      getSearchRadius(pet1.tipo_animal || 'outro'),
      getSearchRadius(pet2.tipo_animal || 'outro')
    );
    return distance <= maxRadius * 1.5; // Margem de 50%
  }

  // API pública
  return {
    getCurrentPosition,
    getLastLocation,
    calculateDistance,
    isWithinRadius,
    getSearchRadius,
    filterByProximity,
    findUsersInAlertRadius,
    formatDistance,
    reverseGeocode,
    getMapUrl,
    arePetsInSameRegion,
    RAIO_BUSCA
  };

})();
