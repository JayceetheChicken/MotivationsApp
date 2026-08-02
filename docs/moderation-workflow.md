# Moderationsworkflow

Dieser Betreiberablauf ist serverseitig vorbereitet; die App enthält bewusst
kein Admin-Geheimnis und kein Admin-Dashboard.

## Rollen und Zugriff

- Nutzer erstellen Meldungen ausschließlich über
  `submit_content_report`. Ziel-ID und Mitgliedschaft/Sichtbarkeit werden
  serverseitig geprüft; pro Nutzer gelten Rate Limits und höchstens eine offene
  Meldung je Zieltyp/Ziel.
- Direkte Tabellenrechte auf `content_reports` sind für `anon` und
  `authenticated` entzogen. Der eigene Datenexport enthält nur die sichere
  Projektion der eigenen Meldungen.
- Betreiber lesen die Queue ausschließlich in einer geschützten Supabase-
  Operator-/SQL-Sitzung. Ein Service-Role-Key darf niemals in App, Browser,
  Ticket, Screenshot oder Chat kopiert werden.

## Bearbeitung

1. Offene Meldungen in einer geschützten Operator-Sitzung nach `created_at`
   prüfen. Beschreibung nur zweckgebunden anzeigen; keine Kopie unnötiger
   personenbezogener Daten in Tickets anlegen.
2. Mit der service-role-only RPC `moderate_content_report` auf `reviewing`
   setzen. `moderator_reference` ist eine kurze interne Ticket-/Rollenreferenz,
   kein Klarname und kein Inhaltsdump.
3. Ergebnis als `resolved` oder `rejected` speichern. Aktionen:
   - `none`: Statusentscheidung ohne Inhaltsänderung,
   - `hide` oder `remove`: Profil-/Gruppenname neutralisieren, Bildreferenz
     entfernen, gemeinsames Ziel soft-deleten oder gemeinsame Session
     abbrechen.
4. Eine eventuell erforderliche Kontosperre erfolgt separat über den
   geschützten Supabase-Auth-Betreiberweg. Die App-RPC gewährt keine Adminrolle.
5. Beschwerden an [BESCHWERDEKONTAKT VOR RELEASE EINFÜGEN] dokumentieren und
   Zugriff sowie Aufbewahrungsfrist auf das notwendige Maß begrenzen.

Beispiel nur in einer autorisierten Operator-SQL-Sitzung:

```sql
select public.moderate_content_report(
  '<REPORT_UUID>',
  'resolved',
  'hide',
  'Verstoß nach interner Richtlinie bestätigt',
  'ticket-1234'
);
```

Vor Produktion sind reale Rollen, Vier-Augen-Prinzip, Reaktionsfristen,
Beschwerdeprozess und Löschfrist für Meldungen rechtlich/organisatorisch
festzulegen.
