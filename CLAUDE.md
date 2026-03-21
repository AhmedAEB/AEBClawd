# AEBClawd - This file outlines the project, its goals, and some coding standards.

## Project Overview
AEBClawd is a web application that allows Ahmed to use his claude code from anywhere to do whatever he wants.

## Frontend Style Guidelines
The UI follows a **minimalist / brutalist** design language. Stick to these rules:

- **Colors**: White and black only. No color accents, no gradients. Use `--color-fg` (#000) for text/borders and `--color-void` (#FFF) for backgrounds.
- **Borders**: Solid black lines (`border-edge`). Use `border-2` for emphasis (header, input, approval cards). No colored or translucent borders.
- **Corners**: Sharp square corners everywhere. Never use `rounded-*` classes.
- **Effects**: No blur, no glow, no box-shadow, no backdrop-filter. Keep everything flat.
- **Buttons**: Primary buttons are solid black bg with white text (`bg-fg text-void`). Secondary/destructive buttons use a black border outline (`border-2 border-fg`).
- **Typography**: Uppercase + wide letter-spacing for headings and labels. Fonts: Manrope (sans), JetBrains Mono (mono), Syne (display).
- **Spacing**: Keep it tight and functional. No decorative padding.
- **Semantic colors**: All mapped to black — no green/red/blue/yellow differentiation. Differentiate by labels and position, not color.