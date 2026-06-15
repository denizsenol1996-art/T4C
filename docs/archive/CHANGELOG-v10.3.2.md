# T4C v10.3.2 — Changelog

## Inbox Fix
- **BUG**: Admin inbox toonde altijd "Geen berichten" — API stuurde `requests` terug maar admin verwachtte `rows`. Gefixt.
- **VERBETERD**: Inbox tabel toont nu meer info: Type (B2B/contact), Bedrijf, Telefoon, KvK, Onderwerp/Bericht preview
- **VERBETERD**: Inbox zoekfunctie zoekt nu ook op bedrijf en onderwerp

## OpenAI API
- `backend/.env` aangemaakt met template voor `OPENAI_API_KEY`
- AI integratie was al volledig ingebouwd — alleen key invullen in `.env`

## Hoe OpenAI activeren
1. Open `backend/.env`
2. Vervang `sk-...` door je echte API key
3. Herstart de server
4. Check in Admin → AI Services of OpenAI groen is
