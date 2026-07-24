export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { start, destination, mode = 'driving' } = req.body;

  try {
    // 1. 카카오 / Nominatim 기반 좌표 검색
    async function getCoordinates(keyword) {
      if (process.env.KAKAO_REST_KEY) {
        try {
          const kakaoRes = await fetch(
            `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`,
            { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}` } }
          );
          if (kakaoRes.ok) {
            const kData = await kakaoRes.json();
            if (kData.documents && kData.documents.length > 0) {
              return {
                lat: parseFloat(kData.documents[0].y),
                lng: parseFloat(kData.documents[0].x)
              };
            }
          }
        } catch (e) { console.warn("Kakao search failed:", e); }
      }

      const nomRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(keyword + ' 대한민국')}`,
        { headers: { 'User-Agent': 'TrafficLightMapApp/1.0' } }
      );
      if (nomRes.ok) {
        const nomData = await nomRes.json();
        if (nomData && nomData.length > 0) {
          return { lat: parseFloat(nomData[0].lat), lng: parseFloat(nomData[0].lon) };
        }
      }

      throw new Error(`"${keyword}"의 위치 좌표를 찾을 수 없습니다.`);
    }

    const startCoord = await getCoordinates(start);
    const destCoord = await getCoordinates(destination);
    const coords = { start: startCoord, dest: destCoord };

    // 2. 도로 라인 정교화 (OSRM profile 및 steps 지정)
    let routeGeometry = null;
    try {
      const osrmMode = mode === 'foot' ? 'foot' : 'car';
      const osrmUrl = `https://router.project-osrm.org/route/v1/${osrmMode}/${coords.start.lng},${coords.start.lat};${coords.dest.lng},${coords.dest.lat}?overview=full&geometries=geojson&steps=true`;
      
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();

      if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
        routeGeometry = osrmData.routes[0].geometry;
      }
    } catch (osrmErr) {
      console.warn("OSRM Router Error:", osrmErr);
    }

    // 3. 경찰청 신호등 교차로 정보 수집
    let trafficLights = [];
    if (process.env.TRAFFIC_LIGHT_API_KEY) {
      try {
        const trafficApiKey = process.env.TRAFFIC_LIGHT_API_KEY;
        const trafficUrl = `https://apis.data.go.kr/B551982/rti/crsrd_map_info?serviceKey=${trafficApiKey}&type=json&pageNo=1&numOfRows=300`;
        
        const trafficRes = await fetch(trafficUrl);
        if (trafficRes.ok) {
          const tData = await trafficRes.json();
          const rawItems = tData?.response?.body?.items?.item || tData?.body?.items || [];
          const items = Array.isArray(rawItems) ? rawItems : [rawItems];
          
          trafficLights = items.map(item => ({
            name: item.crsrdNm || item.itstNm || '신호 교차로',
            lat: parseFloat(item.crsrdY || item.lat || item.y || 0),
            lng: parseFloat(item.crsrdX || item.lng || item.x || 0)
          })).filter(item => item.lat > 0 && item.lng > 0);
        }
      } catch (tErr) {
        console.warn("Traffic API fetch error:", tErr);
      }
    }

    return res.status(200).json({
      success: true,
      coords,
      routeGeometry,
      trafficLights
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
