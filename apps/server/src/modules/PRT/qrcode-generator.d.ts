declare module 'qrcode-generator' {
  interface QrCode {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, column: number): boolean;
  }

  export default function qrcode(typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): QrCode;
}

declare module 'jsqr' {
  export default function jsQR(data: Uint8ClampedArray, width: number, height: number): { data: string } | null;
}
