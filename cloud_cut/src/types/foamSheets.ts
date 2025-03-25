export interface FoamSheet {
  color: string;
  thickness: number;
}

export const FOAM_SHEETS: FoamSheet[] = [
  // 30mm thickness - all colors
  { color: "Blue", thickness: 30 },
  { color: "Green", thickness: 30 },
  { color: "Black", thickness: 30 },
  { color: "Orange", thickness: 30 },
  { color: "Red", thickness: 30 },
  { color: "Teal", thickness: 30 },
  { color: "Yellow", thickness: 30 },
  { color: "Pink", thickness: 30 },
  { color: "Purple", thickness: 30 },
  { color: "Gray", thickness: 30 },

  // 50mm thickness - all colors
  { color: "Blue", thickness: 50 },
  { color: "Green", thickness: 50 },
  { color: "Black", thickness: 50 },
  { color: "Orange", thickness: 50 },
  { color: "Red", thickness: 50 },
  { color: "Teal", thickness: 50 },
  { color: "Yellow", thickness: 50 },
  { color: "Pink", thickness: 50 },
  { color: "Purple", thickness: 50 },
  { color: "Gray", thickness: 50 },

  // 70mm thickness - all colors except pink and purple
  { color: "Blue", thickness: 70 },
  { color: "Green", thickness: 70 },
  { color: "Black", thickness: 70 },
  { color: "Orange", thickness: 70 },
  { color: "Red", thickness: 70 },
  { color: "Teal", thickness: 70 },
  { color: "Yellow", thickness: 70 },
  { color: "Gray", thickness: 70 }
]; 