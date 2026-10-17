import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Un site construit pour être mis en ligne doit connaître l'adresse de son API (frontend/.env.production ou
  // variable VITE_API_URL de l'hébergeur). Sans elle, on arrête le build plutôt que de publier un site qui
  // chercherait l'API sur l'ordinateur de chaque visiteur.
  if (command === 'build' && mode === 'production') {
    const { VITE_API_URL } = loadEnv(mode, process.cwd(), '')
    if (!VITE_API_URL) {
      throw new Error("VITE_API_URL manquante : renseignez l'adresse de l'API dans frontend/.env.production (ou dans les variables de l'hébergeur).")
    }
    if (/^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(VITE_API_URL)) {
      throw new Error(`VITE_API_URL pointe vers une adresse locale (${VITE_API_URL}) : le site en ligne ne fonctionnerait que sur cet ordinateur.`)
    }
  }
  return { plugins: [react()] }
})
