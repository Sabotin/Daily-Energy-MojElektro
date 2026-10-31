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

## Informacije

**Posodabljanje podatkov.** porabim.com vsak dan preverja nove podatke med 6:05 in 11:05, in sicer vsako uro, dokler niso na voljo vsi podatki za prejšnji dan. Podatki za posamezne 15-minutne intervale so običajno na voljo okoli 6:00. Podatki o skupni porabi števcev (z VT/MT) so praviloma na voljo šele naslednji dan. Do takrat se včerajšnja poraba izračunava iz 15-minutnih podatkov.

**Zasebnost.** Podatki in API-žeton za Moj Elektro so shranjeni na porabim.com ([politika zasebnosti](https://porabim.com/zasebnost)). Home Assistant hrani samo ključ za dostop do porabim.com, ki nikoli ne pride do vašega brskalnika. Obisk spletne strani porabim.com se zabeleži le ob odprtju nadzorne plošče, ne pa tudi ob vsakem posodabljanju podatkov.

**Več merilnih mest.** Vsa merilna mesta so prikazana v istem računu in v istem vnosu v stranski vrstici. Novo merilno mesto lahko dodate z gumbom **+** na plošči Daily Energy ali prek možnosti **Dodaj integracijo**. V obeh primerih vnesete merilno mesto in žeton.

**Račun za Home Assistant.** Integracija uporablja en račun na porabim.com. Račun ostane enak tudi, če integracijo izbrišete in jo nato znova dodate. Če integracijo izbrišete, se povezava s porabim.com prekine. Ob ponovni nastavitvi izberete eno od merilnih mest, ki so že povezana z vašim računom.

**Brisanje računa.** Če v nastavitvah plošče izberete **Izbriši moj račun**, se račun na porabim.com izbriše, integracija pa se odstrani iz Home Assistanta. Če ste račun pred tem izbrisali neposredno na porabim.com, se bo ob naslednji povezavi ustvaril nov račun.

**Ponovna povezava.** Če porabim.com zavrne ključ za dostop, na primer zato, ker je bil račun izbrisan, vas Home Assistant pozove, da znova povežete integracijo. To storite v razdelku **Naprave in storitve → Daily Energy → Ponovno konfiguriraj**. Do uspešne ponovne povezave podatki in entitete integracije niso na voljo.

**Če porabim.com ni dosegljiv.** Home Assistant prikaže napako in ponudi možnost **Poskusi znova**. Ko je porabim.com znova dosegljiv, lahko povezavo poskusite vzpostaviti še enkrat.

<details><summary>Nadgradnja z različice 1</summary>

Home Assistant vas prosi, da se povežete s porabim.com (Popravila → **Poveži s porabim.com**). Po prvi povezavi se vaš dnevnik enkrat naloži na porabim.com, na svoje merilno mesto, in izbriše iz Home Assistanta. Ste imeli v različici 1 več merilnih mest? Povežite prvo; **Ponovno konfiguriraj** pri vsakem od drugih doda njegovo merilno mesto in dnevnik v isti račun in ta vnos odstrani.

</details>

## Licenca

Vse pravice pridržane, glejte [LICENSE](LICENSE). Projekt ni povezan z Elektro Slovenije ali katerim koli distribucijskim podjetjem.
