export function identifyFoamSheet(name: string, options?: string): string {
  // First check if options contain foam sheet information
  if (options) {
    const optionsMatch = options.match(/([A-Za-z]+)\s*\/?\s*(\d+mm)/);
    if (optionsMatch) {
      const [, color, thickness] = optionsMatch;
      return `${color.trim()} ${thickness.trim()}`;
    }
  }

  // Try to find foam sheet info in parentheses at the end
  const parenthesesMatch = name.match(/\((\d+mm),\s*([A-Za-z]+)\)$/);
  if (parenthesesMatch) {
    const [, thickness, color] = parenthesesMatch;
    return `${color.trim()} ${thickness.trim()}`;
  }

  // Look for color and thickness pattern at the end of the name
  const foamPattern = /([A-Za-z]+)\s*\/?\s*(\d+mm)(?:\s*\(Pack of \d+\))?$/;
  const match = name.match(foamPattern);
  
  if (match) {
    const [, color, thickness] = match;
    return `${color.trim()} ${thickness.trim()}`;
  }
  
  // Try to find thickness in the middle of the name (e.g., "600mm x 420mm x 50mm")
  const dimensionsMatch = name.match(/(\d+mm)\s*x\s*\d+mm\s*x\s*(\d+mm)/);
  if (dimensionsMatch) {
    const [, thickness] = dimensionsMatch;
    // Look for a color anywhere in the name
    const colorInName = name.match(/([A-Za-z]+)(?:\s*\/\s*\d+mm)?/);
    if (colorInName) {
      return `${colorInName[1].trim()} ${thickness.trim()}`;
    }
  }

  // If no match found, check for just color or just thickness
  const colorMatch = name.match(/([A-Za-z]+)\s*(?:\(Pack of \d+\))?$/);
  const thicknessMatch = name.match(/(\d+mm)(?:\s*\(Pack of \d+\))?$/);
  
  if (colorMatch && thicknessMatch) {
    return `${colorMatch[1].trim()} ${thicknessMatch[1].trim()}`;
  }
  
  return 'N/A';
} 