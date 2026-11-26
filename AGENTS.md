# Repository Guidelines

## Project Structure

Oslo Live Transit is a React and TypeScript app that displays live vehicles on a MapLibre map. `src/main.tsx` mounts the app. `src/App.tsx` coordinates filters, search, and selection.

- Place UI components in `src/components/`. Map layer definitions, GeoJSON helpers, and vehicle animation logic live in `src/components/map/`.
- Keep polling and data-loading hooks in `src/hooks/`, Entur and Ruter integrations in `src/services/`, and shared transit types in `src/types/transit.ts`.
- Edit global styles and color tokens in `src/styles/index.css`. The app uses Lucide icons and inline SVG, and loads fonts through `index.html`.

## Development and Build Commands

Use Node.js 22 to match the GitHub Pages workflow. Run commands from the repository root.

- `npm ci` installs dependencies from `package-lock.json`.
- `npm run dev` starts the Vite development server with hot reload.
- `npm run build` checks strict TypeScript types and creates the production bundle in `dist/`.
- `npm run preview` serves the latest production build locally.

## Coding Style and Naming

Use two-space indentation, single quotes in TypeScript, and semicolons. Match the surrounding code’s formatting. The repository has no configured linter or formatter.

Use PascalCase for components and their files (`VehicleDetailCard.tsx`), and camelCase for hooks and helpers (`useLiveVehicles.ts`, `mapLayers.ts`). Follow existing imports by including local `.ts` or `.tsx` extensions and using `import type` for type-only dependencies.

## Testing

The repository has no automated test suite or coverage threshold. Run `npm run build` before submitting changes, then exercise the affected flow in the browser. For example, after changing bus stop overlays, select Bus and zoom across level 13 to verify that stops appear and disappear. For camera changes, check both desktop dragging and touch gestures while following a vehicle.

## Commits and Pull Requests

Use a short imperative commit subject that names the behavior, such as `Fit viewport on search and subdue unselected vehicles`. In a pull request, describe the user-visible change and list the checks you ran. Link a related issue when available and include a screenshot or short recording for layout or gesture changes.
