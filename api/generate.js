export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { start, destination, mode = 'driving' } = req.body;

  try {
    // 1. 카카오 / Gemini 기반 좌표 변환
    async function getCoordinates(keyword) {
      // 카카오 키워드 검색 시도
      try {
        const kakaoRes = await fetch(
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`,
          { headers: { Authorization: `KakaoAK 1d1676675e478ee92787d55eb908f9f6` } }
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
      } catch (e) {
        console.warn("Kakao search failed, falling back to Gemini:", e);
      }

      // Gemini 2.5 Flash Lite Fallback
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY 환경변수가 설정되지 않았습니다.");
      }

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `"${keyword}" (대한민국)의 위도(lat)와 경도(lng) 좌표를 알려줘. 다른 설명 없이 오직 JSON 형식으로만 응답해: {"lat": 위도숫자, "lng": 경도숫자}`
              }]
            }],
            generationConfig: { responseMimeType: "application/json" }
          })
        }
      );

      const geminiData = await geminiRes.json();

      // Gemini API 에러 처리 (candidates가 없는 경우 대응)
      if (!geminiRes.ok || !geminiData.candidates || geminiData.candidates.length === 0) {
        console.error("Gemini API Error Detail:", JSON.stringify(geminiData));
        throw new Error(`Gemini 위치 검색 실패: ${geminiData.error?.message || '응답 데이터 없음'}`);
      }

      const rawText = geminiData.candidates[0].content.parts[0].text;
      return JSON.parse(rawText);
    }

    const startCoord = await getCoordinates(start);
    const destCoord = await getCoordinates(destination);
    const coords = { start: startCoord, dest: destCoord };

    // 2. OSRM 도로 경로 계산
    let routeGeometry = null;
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/${mode}/${coords.start.lng},${coords.start.lat};${coords.dest.lng},${coords.dest.lat}?overview=full&geometries=geojson`;
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();

      if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
        routeGeometry = osrmData.routes[0].geometry;
      }
    } catch (osrmErr) {
      console.warn("OSRM Error:", osrmErr);
    }

    // 3. 경찰청 신호 정보 API (/crsrd_map_info)
    let trafficLights = [];
    try {
      if (process.env.TRAFFIC_LIGHT_API_KEY) {
        const trafficApiKey = process.env.TRAFFIC_LIGHT_API_KEY;
        const trafficUrl = `https://apis.data.go.kr/B551982/rti/crsrd_map_info?serviceKey=${trafficApiKey}&type=json&pageNo=1&numOfRows=50`;
        
        const trafficRes = await fetch(trafficUrl);
        if (trafficRes.ok) {
          const tData = await trafficRes.json();
          const items = tData?.response?.body?.items?.item || tData?.body?.items || [];
          trafficLights = Array.isArray(items) ? items : [items];
        } else {
          console.warn("Traffic API HTTP Status:", trafficRes.status);
        }
      }
    } catch (tErr) {
      console.warn("신호등 API 연동 실패:", tErr);
    }

    return res.status(200).json({
      success: true,
      coords,
      routeGeometry,
      trafficLights
    });

  } catch (error) {
    console.error("Server Handler Error:", error);
    return res.status(500).json({ success: false, error: error.message || '서버 처리 중 오류가 발생했습니다.' });
  }
}
