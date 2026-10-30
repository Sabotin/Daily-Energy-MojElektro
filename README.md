<p align="center"><img src="assets/logo.webp" alt="Daily Energy" width="420"></p>

# Dnevni pregled porabe za Moj Elektro

Pregled porabe energije za Home Assistant. Podatke hrani in vsako jutro prenese iz Moj Elektro [porabim.com](https://porabim.com); integracija v Home Assistantu pokaže njegovo nadzorno ploščo v stranski vrstici.

![Daily Energy v Home Assistantu](assets/dashboard.webp)

## Funkcije

- Včerajšnja poraba v primerjavi s 30-dnevnim povprečjem in s tem, koliko običajno porabite ob tem času
- Ocena računa za ta in prejšnji mesec: energija, omrežnina, prispevki in DDV
- Moč v 15-minutnih intervalih po dnevih, z najvišjo vrednostjo za posamezen blok
- Dogovorjena moč: najvišja moč po blokih glede na dogovorjeno in predlog optimalne dogovorjene moči
- Grafi dnevne, tedenske, mesečne in letne porabe
- Ločen prikaz VT / MT ali vse kot ena tarifa (ET)
- Tarifni bloki 1 do 5
- Stalna poraba, ta teden, ta mesec in to leto na enem mestu
- Pripomočki, ki jih dodate sami: cena elektrike ta trenutek, načrt varčevanja, teden proti tednu, zima proti poletju, deli dneva in drugi
- Celotna zgodovina podatkov iz Moj Elektro za poljubno časovno obdobje
- Odjem, Neto in Oddaja za sončne elektrarne
- Elektrarna: proizvodnja, baterija in prihranek iz oblaka vašega razsmernika (SolarEdge, Huawei, Growatt)
- Do 3 merilna mesta v istem računu
- Slovenščina ali angleščina
- Minimalističen način za tablice na steni
- Entitete za vsako merilno mesto: odjem in oddaja (zadnji dan, ta mesec, prejšnji mesec), bloki, najvišja moč, dogovorjena moč, ocena računa in elektrarna, za avtomatizacije in nadzorne plošče

## Zahteve

- Home Assistant 2024.12 ali novejši
- Integracija **My Home Assistant** (del `default_config`)
- API-žeton Moj Elektro: [mojelektro.si](https://mojelektro.si) → Moj profil → **Kreiraj žeton** (neomejena veljavnost)
- ID merilnega mesta (EIMM): Merilna mesta / merilne točke, npr. `4-123456`

## Namestitev

[![Dodaj v HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Sabotin&repository=Daily-Energy-MojElektro&category=integration)

1. Kliknite zgornji gumb → **Download** → ponovno zaženite Home Assistant
2. Dodajte integracijo **Daily Energy for Moj Elektro** → odpre se porabim.com → vnesite ID merilnega mesta in API-žeton → **Poveži**
3. Nazaj v Home Assistantu se **Daily Energy** prikaže v stranski vrstici. Entitete so nedosegljive, dokler porabim.com ne prenese prvih podatkov iz Moj Elektro.

   [![Dodaj integracijo](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=daily_energy_mojelektro)

<details><summary>Brez gumba</summary>

HACS → ⋮ → **Custom repositories** → `https://github.com/Sabotin/Daily-Energy-MojElektro` (Integration) → **Download** →
ponovni zagon → Settings → Devices & services → **Add integration** → **Daily Energy for Moj Elektro**.

</details>

## Nastavitve

**Integracija** (Settings → Devices & services → Daily Energy → Configure): prikaz v stranski vrstici. Merilno mesto in API-žeton nastavite na porabim.com.

**Nadzorna plošča** (gumb z zobnikom):

| | |
|---|---|
| Račun | Povezano prek Home Assistanta, Spremeni PIN, Deli račun |
| Način prikaza | Samodejno, Minimalistično ali Popolno (za vsako napravo posebej) |
| Jezik | Samodejno (po jeziku Home Assistanta), English ali Slovenščina |
| Omrežje | Odjem, ali Odjem in oddaja |
| Kraj (napoved oddaje) | Za napoved oddaje sončne elektrarne |
| Prikaz tarif | ET ali ET · VT · MT |
| Uvozi iz Moj Elektro | Uvoz poljubnega časovnega obdobja |
| Vaši podatki | Izvoz JSON, uvoz CSV / JSON, brisanje vseh podatkov |
| Pomoč | Prijavi težavo, Predlagaj novost |
| Izbriši moj račun | Izbriše račun na porabim.com in integracijo v Home Assistantu |

## Dobro je vedeti

**Kdaj pridejo podatki.** porabim.com preverja nove podatke vsako jutro, vsako uro od 6:05 do 11:05, dokler včerajšnji dan ni popoln. Včerajšnji 15-minutni podatki so običajno na voljo okoli 6:00, skupna poraba števca (z VT / MT) pa šele naslednji dan. Do takrat se včerajšnja poraba prikazuje na podlagi 15-minutnih podatkov.

**Zasebnost.** Podatki in API-žeton Moj Elektro so shranjeni na porabim.com ([zasebnost](https://porabim.com/zasebnost)). Home Assistant hrani samo ključ za porabim.com, ki ne pride do brskalnika. Kot obisk na porabim.com šteje samo odpiranje plošče, ne pa osveževanje entitet v ozadju.

**Več merilnih mest.** Vsa so v istem računu in v istem vnosu v stranski vrstici. Dodate jih z gumbom **+** v plošči Daily Energy ali z **Dodaj integracijo** (vpišete merilno mesto in žeton), oboje deluje enako.

**En račun.** Home Assistant ima na porabim.com en račun. Ostane isti tudi, če integracijo izbrišete in dodate znova. Ko izbrišete integracijo, se povezava na porabim.com prekine. Za ponovno povezavo uporabite eno od merilnih mest v računu.

**Brisanje računa.** **Izbriši moj račun** v nastavitvah plošče izbriše račun na porabim.com in hkrati integracijo iz Naprave in storitve. Če je bil račun izbrisan drugje, se ob ponovni povezavi vnos premakne v novi račun.

**Ponovna povezava.** Če porabim.com zavrne ključ (npr. ker je bil račun izbrisan), vas Home Assistant enkrat prosi za ponovno povezavo (Naprave in storitve → Daily Energy → **Ponovno konfiguriraj**) in porabim.com ne vpraša znova, dokler se ne povežete. Do takrat sta plošča in entitete odjavljeni.

**Ko porabim.com ni dosegljiv.** Plošča to pove in ponudi **Poskusi znova**. Ko je naprava spet na spletu, poskusi znova sama.

<details><summary>Nadgradnja z različice 1</summary>

Home Assistant vas prosi, da se povežete s porabim.com (Popravila → **Poveži s porabim.com**). Po prvi povezavi se vaš dnevnik enkrat naloži na porabim.com, na svoje merilno mesto, in izbriše iz Home Assistanta. Ste imeli v različici 1 več merilnih mest? Povežite prvo; **Ponovno konfiguriraj** pri vsakem od drugih doda njegovo merilno mesto in dnevnik v isti račun in ta vnos odstrani.

</details>

## Licenca

Vse pravice pridržane, glejte [LICENSE](LICENSE). Projekt ni povezan z Elektro Slovenije ali katerim koli distribucijskim podjetjem.
