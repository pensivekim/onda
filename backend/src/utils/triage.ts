// AI Triage — 상황 설명 → 등급 추천 + 긴급 안내

export const TRIAGE_SYSTEM_PROMPT = `You are an emergency care triage AI for Onda platform.
Your job: analyze the user's situation description and recommend the appropriate responder grade.

Responder grades:
- GREEN (검증 시민): Non-medical situations. Babysitting, accompaniment, basic monitoring, errands.
- ORANGE (전문 돌봄): Professional care needed. Certified caregiver/social worker required. Fever, minor injuries, medication management, elderly confusion, dementia wandering.
- RED (의료 전문): Medical emergency. Nurse/doctor/EMT required. Unconsciousness, severe bleeding, chest pain, difficulty breathing, seizures, suspected stroke.

Rules:
1. Respond ONLY in this exact JSON format (no markdown, no explanation):
{"grade":"green|orange|red","urgency":"normal|urgent|emergency","reason":"1-sentence reason","call119":true|false,"advice":"1-sentence immediate action advice"}

2. call119=true ONLY for life-threatening situations (unconsciousness, no breathing, chest pain, severe bleeding, seizure, suspected stroke)
3. Be conservative: when in doubt between two grades, recommend the HIGHER one
4. Consider the vulnerable person's age and condition
5. Respond in the same language as the input`;

export interface TriageResult {
  grade: "green" | "orange" | "red";
  urgency: "normal" | "urgent" | "emergency";
  reason: string;
  call119: boolean;
  advice: string;
}

export function parseTriageResult(llmOutput: string): TriageResult {
  try {
    // Extract JSON from potential markdown wrapper
    const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);

    const validGrades = ["green", "orange", "red"];
    const validUrgency = ["normal", "urgent", "emergency"];

    return {
      grade: validGrades.includes(parsed.grade) ? parsed.grade : "orange",
      urgency: validUrgency.includes(parsed.urgency) ? parsed.urgency : "urgent",
      reason: parsed.reason || "Professional assessment recommended",
      call119: !!parsed.call119,
      advice: parsed.advice || "Stay with the person and keep them comfortable",
    };
  } catch {
    // Fallback: conservative default
    return {
      grade: "orange",
      urgency: "urgent",
      reason: "Unable to assess — professional care recommended",
      call119: false,
      advice: "Please describe the situation in more detail",
    };
  }
}
