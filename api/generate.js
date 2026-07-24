export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { start, destination } = req.body;

  try {
    // 1. Gemini API로 출발지/목적지 이름 -> 위도/경도 좌표 변환
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
    const coords = JSON.parse(geminiData.candidates[0].content.parts[0].text);

    // 2. 공공데이터포털 실시간 신호등 API 호출 (예시 파라미터)
    // * 참고: 선택하신 공공데이터 API의 요청 URL 포맷에 맞게 serviceKey로 전달됩니다.
    const trafficRes = await fetch(
      `https://apis.data.go.kr/1613000/TrafficLightInfoService/getTrafficLightList?serviceKey=${process.env.TRAFFIC_LIGHT_API_KEY}&type=json&pageNo=1&numOfRows=100`
    );
    
    let trafficData = null;
    if (trafficRes.ok) {
      trafficData = await trafficRes.json();
    }

    // 3. 좌표 및 신호등 데이터 전달
    return res.status(200).json({
      success: true,
      coords: coords,
      trafficData: trafficData
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '데이터 처리 중 오류가 발생했습니다.' });
  }
}
