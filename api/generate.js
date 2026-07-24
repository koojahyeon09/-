export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { start, destination, mode = 'driving' } = req.body;

  try {
    // 1. Gemini API: 장소 이름 -> 위도/경도 좌표 변환
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `다음 출발지와 목적지의 위도(latitude)와 경도(longitude) 좌표를 구해줘.
                     출발지: "${start}"
                     목적지: "${destination}"
                     응답은 반드시 추가 설명 없이 아래 JSON 형식으로만 보내줘:
                     {"start": {"lat": 위도숫자, "lng": 경도숫자}, "dest": {"lat": 위도숫자, "lng": 경도숫자}}`
            }]
          }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok || !geminiData.candidates || !geminiData.candidates[0]) {
      console.error("Gemini Error:", geminiData);
      return res.status(500).json({ error: "Gemini 좌표 변환 실패. API 키를 확인해 주세요." });
    }

    const coords = JSON.parse(geminiData.candidates[0].content.parts[0].text);

    // 2. OSRM API: 백엔드에서 도로 경로 데이터 직접 요청
    let routeGeometry = null;
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/${mode}/${coords.start.lng},${coords.start.lat};${coords.dest.lng},${coords.dest.lat}?overview=full&geometries=geojson`;
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();

      if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
        routeGeometry = osrmData.routes[0].geometry;
      }
    } catch (osrmErr) {
      console.warn("OSRM 경로 호출 실패:", osrmErr);
    }

    // 3. 공공데이터 API: 신호등 데이터 수집
    let trafficData = null;
    try {
      if (process.env.TRAFFIC_LIGHT_API_KEY) {
        const trafficRes = await fetch(
          `https://apis.data.go.kr/1613000/TrafficLightInfoService/getTrafficLightList?serviceKey=${process.env.TRAFFIC_LIGHT_API_KEY}&type=json&pageNo=1&numOfRows=100`
        );
        if (trafficRes.ok) {
          trafficData = await trafficRes.json();
        }
      }
    } catch (tErr) {
      console.warn("신호등 데이터 수집 실패:", tErr);
    }

    // 4. 모든 결과를 하나로 합쳐서 전달
    return res.status(200).json({
      success: true,
      coords: coords,
      routeGeometry: routeGeometry, // 백엔드가 계산해 준 OSRM 경로
      trafficData: trafficData
    });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: '서버 처리 중 오류가 발생했습니다.' });
  }
}
