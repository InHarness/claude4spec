# Scope of this run

```json
{
  "unit": {
    "id": "u03-artifact-frontmatter-merge",
    "goal": "Zapis frontmattera artefaktu (plan, brief, patch) scala tylko przesłane klucze z bieżącym frontmatterem pliku. Odczyt i zapis są jedną sekcją krytyczną pod blokadą per ścieżka. Guard hasha w tym zapisie nie istnieje. Równoległy zapis treści albo drugi zapis frontmattera nie gubi zmian. W kodzie trzeba dołączyć do blokady zapis frontmattera patcha, bo plan i brief już ją biorą. Zapis treści planu z edytora świadomie nie niesie podsumowania zmiany: wersję użytkownika odróżnia autor `user` na osi wersji pliku.\n\nUwaga z briefu (endpoint patch-api-artifacts-kind-path-frontmatter): snapshot `after` tego endpointu ma pustą listę podpiętych DTO, choć okno zmieniło tylko opisy. Nie zdejmuj na tej podstawie wiązania request/response, zanim nie sprawdzisz go w odczycie stanu przy `2.1.57`."
  },
  "diff": "git diff bda0c499581bf0294a106cd3b51b2a3e547e9501..HEAD",
  "portions": [
    "u03-artifact-frontmatter-merge/p1-l3-l4"
  ],
  "stateDir": ".c4s-impl/"
}
```
