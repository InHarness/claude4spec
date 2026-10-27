# Scope of this run

```json
{
  "unit": {
    "id": "u3-remove-bundle-archive",
    "goal": "Wydanie przestaje mieć postać przenośnej paczki tar.gz: z serwisu wydań M17 znikają budowanie i odtwarzanie paczki wraz z manifestem, sanityzacją konfiguracji i jej białą listą, układem stron i encji w archiwum oraz cyklem życia pliku tymczasowego. Snapshot, diff i restore opierają się wyłącznie na tabelach wersji (a przy włączonym gicie na gicie); M02, M29, M47 i M52 tracą swoje zachowania specyficzne dla paczki (grupowanie korzeni, kopia tagów z HEAD, paczka jako drugi nośnik snapshotu, wyłączenie kluczy skilli z paczki).",
    "recipe": {
      "pages": [
        {
          "key": "pages/modules/m17-snapshots-releases/bundle-archive-format.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "change": {
            "offset": 0,
            "limit": 4,
            "anchors": [
              "m17bndal1",
              "fvxecxrz",
              "c27dhbf7",
              "a1jgqf43"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "change": {
            "offset": 7,
            "limit": 3,
            "anchors": [
              "vx54r3zf",
              "nw4xpmli",
              "m17reldiff"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "context": {
            "offset": 1,
            "limit": 4,
            "anchors": [
              "m17api001",
              "6if4oa3e",
              "2je62eu5",
              "c27dhbf7"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "context": {
            "offset": 17,
            "limit": 1,
            "anchors": [
              "a1jgqf43"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "context": {
            "offset": 27,
            "limit": 4,
            "anchors": [
              "1f607ym1",
              "m17reldisk",
              "vx54r3zf",
              "nw4xpmli"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/L2-domain.md",
          "context": {
            "offset": 34,
            "limit": 1,
            "anchors": [
              "m17reldiff"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "change": {
            "offset": 0,
            "limit": 2,
            "anchors": [
              "h513zreh",
              "m17zal001"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "change": {
            "offset": 4,
            "limit": 4,
            "anchors": [
              "m17l9001",
              "d8871ce9",
              "9vwvitnu",
              "ic73uiw3"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "xkpt256d",
              "m17zal001"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 18,
            "limit": 1,
            "anchors": [
              "m17l9001"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 27,
            "limit": 1,
            "anchors": [
              "d8871ce9"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 30,
            "limit": 1,
            "anchors": [
              "m17l13rt"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 32,
            "limit": 1,
            "anchors": [
              "9vwvitnu"
            ]
          }
        },
        {
          "key": "pages/modules/m17-snapshots-releases/m17-snapshots-releases.md",
          "context": {
            "offset": 34,
            "limit": 1,
            "anchors": [
              "ic73uiw3"
            ]
          }
        },
        {
          "key": "pages/modules/m02-pages.md",
          "change": {
            "offset": 1,
            "limit": 1,
            "anchors": [
              "m02l13001"
            ]
          }
        },
        {
          "key": "pages/modules/m02-pages.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "487vmesk",
              "lzt9r2fu"
            ]
          }
        },
        {
          "key": "pages/modules/m02-pages.md",
          "context": {
            "offset": 41,
            "limit": 1,
            "anchors": [
              "m02l13001"
            ]
          }
        },
        {
          "key": "pages/modules/m29-entity-store.md",
          "change": {
            "offset": 0,
            "limit": 1,
            "anchors": [
              "m29lay001"
            ]
          }
        },
        {
          "key": "pages/modules/m29-entity-store.md",
          "change": {
            "offset": 2,
            "limit": 1,
            "anchors": [
              "f952122v"
            ]
          }
        },
        {
          "key": "pages/modules/m29-entity-store.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "m29cel001",
              "m29dep001"
            ]
          }
        },
        {
          "key": "pages/modules/m29-entity-store.md",
          "context": {
            "offset": 6,
            "limit": 1,
            "anchors": [
              "m29lay001"
            ]
          }
        },
        {
          "key": "pages/modules/m29-entity-store.md",
          "context": {
            "offset": 16,
            "limit": 1,
            "anchors": [
              "f952122v"
            ]
          }
        },
        {
          "key": "pages/modules/m47-payload-timeline.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m47-payload-timeline.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "f2k75mdn",
              "tp9wojip"
            ]
          }
        },
        {
          "key": "pages/modules/m47-payload-timeline.md",
          "context": {
            "offset": 6,
            "limit": 1,
            "anchors": [
              "l9snap001"
            ]
          }
        },
        {
          "key": "pages/modules/m52-spec-skills.md",
          "change": "all"
        },
        {
          "key": "pages/modules/m52-spec-skills.md",
          "context": {
            "offset": 1,
            "limit": 2,
            "anchors": [
              "q7uurue4",
              "cppnlv9z"
            ]
          }
        },
        {
          "key": "pages/modules/m52-spec-skills.md",
          "context": {
            "offset": 20,
            "limit": 2,
            "anchors": [
              "vixysa1w",
              "wqvq1esb"
            ]
          }
        }
      ],
      "entities": [
        {
          "type": "ac",
          "slugs": [
            "ac-buildbundlearchive-pozostaje-derywowany",
            "ac-bundle-build-dla-release-n-rekonstruuje",
            "ac-bundle-nie-zawiera-tabel-remote-session",
            "ac-bundle-tar-gz-grupuje-strony-w-podkatalo",
            "ac-bundle-zawiera-entities-tags-json-z-h",
            "ac-bundle-zawiera-entities-typeplural-jso",
            "ac-bundle-zawiera-pages-path-md-z-page-ve",
            "ac-bundleschemaversion-odczytany-z-manife",
            "ac-config-json-w-bundle-u-zawiera-tylko-pol",
            "ac-katalog-entities-type-powstaje-dla-ka",
            "ac-korze-tar-bundle-a-zawiera-wy-cznie-ma",
            "ac-m17-restorebundlearchive-stream-imple",
            "ac-manifest-json-zawiera-bundleschemaversio",
            "ac-manifest-serializerversions-per-typ-zac",
            "ac-paczka-wydania-zbudowana-przed-przemi",
            "ac-pages-path-md-w-bundle-filtruje-po-kin",
            "ac-pole-agent-disabledirectfilesystemacc",
            "ac-release-snapshot-diff-bundle-restore-o",
            "ac-release-z-zero-stronami-zero-encjami-b",
            "ac-restore-czyta-bundle-v2-bez-mapy-sing",
            "ac-restore-dotwarza-brakujaca-definicje",
            "ac-restorebundlearchive-w-v1-rzuca-not-impl",
            "ac-sha-256-zwracane-przez-buildbundlearchiv",
            "ac-targzpath-po-buildbundlearchive-istnieje",
            "ac-wpis-encji-w-bundle-u-v3-nie-ma-pola"
          ]
        },
        {
          "type": "code-snippet",
          "slugs": [
            "release-service-contract"
          ]
        },
        {
          "type": "dto",
          "slugs": [
            "bundle-manifest",
            "spec-snapshot-entity-row"
          ]
        },
        {
          "type": "endpoint",
          "slugs": [
            "get-api-releases-nameorid-snapshot"
          ]
        },
        {
          "type": "database-table",
          "slugs": [
            "file-version"
          ]
        },
        {
          "type": "spreadsheet",
          "slugs": [
            "sub-drzewo-m17",
            "moduly-feature"
          ]
        }
      ]
    },
    "jobs": []
  },
  "stateDir": ".c4s-impl/",
  "mode": "split"
}
```
