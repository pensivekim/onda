// qrcode-generator 1.4.4 타입 (필요한 것만)
declare const qrcode: (typeNumber: number, level: 'L' | 'M' | 'Q' | 'H') => {
  addData(d: string): void; make(): void;
  createSvgTag(o: { cellSize?: number; margin?: number; scalable?: boolean }): string;
};
export default qrcode;
