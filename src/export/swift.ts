import { rgbOf, rolesToLines, titleLine, type ExportInput } from './keys';

function color(hex: string): string {
  const rgb = rgbOf(hex);
  return `Color(red: ${rgb.r} / 255, green: ${rgb.g} / 255, blue: ${rgb.b} / 255)`;
}

export function swiftExport(input: ExportInput): string {
  const line = (key: string, hex: string) => `static let ${key} = ${color(hex)}`;
  return `// ${titleLine(input)}
import SwiftUI

extension Color {
    enum Huezz {
        enum Clair {
${rolesToLines(input.theme.light, 'swift', '            ', line)}
        }

        enum Sombre {
${rolesToLines(input.theme.dark, 'swift', '            ', line)}
        }
    }
}
`;
}
