const ENVIRONMENT_VARIABLE_EXPRESSION =
  /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/;

export function normalizeConfigDropText(value: string) {
  const environmentVariable = value.match(ENVIRONMENT_VARIABLE_EXPRESSION);
  return environmentVariable ? `{{env.${environmentVariable[1]}}}` : value;
}

export function insertDroppedText(
  value: string,
  droppedText: string,
  selectionStart: number | null,
  selectionEnd: number | null,
) {
  const start = selectionStart ?? value.length;
  const end = selectionEnd ?? start;
  const nextValue = `${value.slice(0, start)}${droppedText}${value.slice(end)}`;

  return {
    caret: start + droppedText.length,
    value: nextValue,
  };
}
