export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { start, destination, mode = 'driving' } = req.body;

  try {
    // 1. OpenStreetMap Nominatim 위치 검색
    async function getCoordinates(keyword) {
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
      throw new Error(`"${keyword}"의 위치를 찾을 수 없습니다.`);
    }

    const startCoord = await getCoordinates(start);
    const destCoord = await getCoordinates(destination);
    const coords = { start: startCoord, dest: destCoord };

    // 2. OSRM 경로 계산 (보행자 / 차도 모드 선택 가능)
    let routeGeometry = null;
    let pathPoints = [];

    try {
      const osrmMode = mode === 'foot' ? 'foot' : 'car';
      const osrmUrl = `https://router.project-osrm.org/route/v1/${osrmMode}/${coords.start.lng},${coords.start.lat};${coords.dest.lng},${coords.dest.lat}?overview=full&geometries=geojson&steps=true`;
      
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();

      if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
        routeGeometry = osrmData.routes[0].geometry;
        
        const legs = osrmData.routes[0].legs || [];
        legs.forEach(leg => {
          leg.steps.forEach(step => {
            if (step.intersections) {
              step.intersections.forEach(intersection => {
                pathPoints.push({
                  lat: intersection.location[1],
                  lng: intersection.location[0],
                  name: step.name ? `${step.name} 교차로` : '신호 교차로'
                });
              });
            }
          });
        });
      }
    } catch (osrmErr) {
      console.warn("OSRM Error:", osrmErr);
    }

    // 주요 교차로 추출 및 신호등 초기화 정보 부여 (60초 주기 시뮬레이션용)
    const trafficLights = pathPoints
      .filter((pt, idx, self) =>
        idx === self.findIndex((t) => Math.abs(t.lat - pt.lat) < 0.0005 && Math.abs(t.lng - pt.lng) < 0.0005)
      )
      .map((tl, index) => ({
        id: `tl_${index}`,
        name: tl.name,
        lat: tl.lat,
        lng: tl.lng,
        // 각 신호등마다 고유한 시작 오프셋(초)을 부여하여 개별적으로 신호가 바뀌도록 설정
        offset: (index * 17) % 60 
      }));

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
