export function extractJSON(text: string): unknown {
  // Strip <think>...</think>
  let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  
  // Strip markdown fences
  cleanText = cleanText.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1");
  
  // Find first balanced JSON object
  const start = cleanText.indexOf('{');
  if (start === -1) {
    throw new Error("No JSON object found");
  }
  
  let end = -1;
  let depth = 0;
  for (let i = start; i < cleanText.length; i++) {
    if (cleanText[i] === '{') depth++;
    if (cleanText[i] === '}') depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  
  if (end === -1) {
    throw new Error("Unbalanced JSON object");
  }
  
  const jsonStr = cleanText.substring(start, end + 1);
  return JSON.parse(jsonStr);
}
