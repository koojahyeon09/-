export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { start, destination, mode = 'driving' } = req.body;

  try {
    // 1. 장소 검색 (카카오/OpenStreetMap 우회 키워드 검색으로 정확도 확보)
    async function getCoordinates(keyword) {
      // OpenStreetMap Nominatim 한국 지역 검색
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(keyword)}&countrycodes=kr&limit=1`;
      const response = await fetch(url, { headers: { 'User-Agent': 'TrafficLightApp/1.0' } });
      const data = await response.json();

      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }

      // 실패 시 Gemini를 보조(Fallback)로 사용
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `"${keyword}"의 정확한 위도(lat)와 경도(lng) 좌표를 알려줘. JSON으로만 응답: {"lat": 위도, "lng": 경도}`
              }]
            }],
            generationConfig: { responseMimeType: "application/json" }
          })
        }
      );
      const geminiData = await geminiRes.json();
      return JSON.parse(geminiData.candidates[0].content.parts[0].text);
    }

    const startCoord = await getCoordinates(start);
    const destCoord = await getCoordinates(destination);
    const coords = { start: startCoord, dest: destCoord };

    // 2. OSRM API: 도로 경로 계산
    let routeGeometry = null;
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/${mode}/${coords.start.lng},${coords.start.lat};${coords.dest.lng},${coords.dest.lat}?overview=full&geometries=geojson`;
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();

      if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
        routeGeometry = osrmData.routes[0].geometry;
      }
    } catch (osrmErr) {
      console.warn("OSRM 실패:", osrmErr);
    }

    // 3. 공공데이터 API: 신호등 데이터 가져오기
    let trafficLights = [];
    try {
      if (process.env.TRAFFIC_LIGHT_API_KEY) {
        // 공공데이터포털 실시간/위치별 신호등 호출
        const trafficUrl = `https://apis.data.go.kr/1613000/TrafficLightInfoService/getTrafficLightList?serviceKey=${process.env.TRAFFIC_LIGHT_API_KEY}&type=json&pageNo=1&numOfRows=50`;
        const trafficRes = await fetch(trafficUrl);
        if (trafficRes.ok) {
          const tData = await trafficRes.json();
          // 신호등 목록 추출 (구조에 맞춰 파싱)
          const items = tData?.response?.body?.items?.item || tData?.items || [];
          trafficLights = Array.isArray(items) ? items : [items];
        }
      }
    } catch (tErr) {
      console.warn("신호등 데이터 호출 실패:", tErr);
    }

    return res.status(200).json({
      success: true,
      coords: coords,
      routeGeometry: routeGeometry,
      trafficLights: trafficLights
    });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: '서버 처리 중 오류가 발생했습니다.' });
  }
}
