# T4C — Transfer4Cars

Automotive Intelligence Platform voor de Nederlandse automarkt.

## Snelstart (Docker — aanbevolen)

```powershell
cd C:\Users\deniz\Desktop\t4c
docker compose up -d
```

Klaar. Alles draait:
- **Dashboard**: http://localhost (via nginx)
- **API docs**: http://localhost:8000/api/docs
- **Health check**: http://localhost:8000/health
- **Direct frontend**: http://localhost:3000

## Management Script

```powershell
.\manage.ps1 status    # Container status overzicht
.\manage.ps1 health    # Health check alle services + database stats
.\manage.ps1 restart   # Herstart crashed containers (VEILIG)
.\manage.ps1 logs      # Live logs volgen
.\manage.ps1 rebuild   # Rebuild images, GEEN data verlies
.\manage.ps1 db        # Database info + source status
```

## Lokaal Ontwikkelen (PyCharm)

Als je backend/workers lokaal wilt draaien voor debugging:

```powershell
# 1. Start alleen database + redis
docker compose up postgres redis -d

# 2. Kopieer .env.local → .env (eenmalig)
copy .env.local .env

# 3. Install Python deps
cd backend
pip install -r requirements.txt
cd ..

# 4. Start backend
cd backend
python -m uvicorn app.main:app --reload --port 8000

# 5. Start een worker (apart terminal)
python -m workers.ingestion.worker
```

## Architectuur

```
t4c/
├── backend/           FastAPI backend
│   ├── app/
│   │   ├── api/routes/   API endpoints (vehicles, listings, dashboard)
│   │   ├── core/         Config, database, cache, logging
│   │   ├── middleware/   Rate limiting, request logging
│   │   ├── models/       SQLAlchemy ORM modellen
│   │   ├── schemas/      Pydantic request/response schemas
│   │   └── services/     RDW, valuation, deals, defects
│   └── Dockerfile
├── workers/           Background workers
│   ├── ingestion/     Listings ophalen van sources
│   ├── valuation/     Waarde berekenen per voertuig
│   ├── deals/         Deal scores berekenen
│   └── sources/       Source adapters (AutoScout24, Marktplaats, Mobile.de)
├── frontend/          Next.js 14 dashboard
├── database/          SQL schema
├── config/nginx/      Reverse proxy config
├── docker-compose.yml
├── manage.ps1         PowerShell management script
└── .env               Environment variabelen
```

## API Endpoints

| Endpoint | Methode | Omschrijving |
|----------|---------|-------------|
| `/api/v1/vehicles/lookup` | POST | Kenteken opzoeken via RDW |
| `/api/v1/vehicles/search` | GET | Voertuigen zoeken |
| `/api/v1/vehicles/{id}` | GET | Voertuig detail |
| `/api/v1/listings/` | GET | Listings zoeken + filters |
| `/api/v1/listings/deals` | GET | Top deals |
| `/api/v1/listings/{id}` | GET | Listing detail + prijs historie |
| `/api/v1/valuations/calculate` | POST | Waarde berekenen |
| `/api/v1/dashboard/stats` | GET | Dashboard statistieken |
| `/health` | GET | System health check |

## Sources

| Bron | Status | Type |
|------|--------|------|
| RDW Open Data | ✅ Actief | API (gratis, geen key nodig) |
| AutoScout24 NL | ✅ Adapter klaar | HTML parsing |
| Marktplaats | ✅ Adapter klaar | API |
| Mobile.de | ✅ Adapter klaar | HTML parsing |

## Problemen Oplossen

**Containers starten niet:**
```powershell
.\manage.ps1 health     # Check wat down is
.\manage.ps1 restart    # Herstart crashed containers
docker compose logs backend  # Bekijk backend logs
```

**Database wachtwoord fout:**
```powershell
# Check of .env correct is
cat .env
# Moet bevatten: DB_PASSWORD=t4c_secret_2024
```

**Workers crash loop:**
```powershell
docker logs t4c-worker-ingestion --tail=50
# Meestal: database connectie fout → check postgres status
```

**Schone start (ALLEEN als echt nodig):**
```powershell
docker compose down       # Stop containers
docker volume rm t4c_postgres_data  # ALLEEN als database corrupt is
docker compose up -d      # Herstart alles (nieuwe database)
```
