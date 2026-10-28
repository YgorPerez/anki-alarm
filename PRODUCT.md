# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

The phone app (Expo + React Native) is the primary surface. A web app shares its visual identity and
tokens for study, editing and stats. It never rings alarms. iOS comes later.

## Users

Friends who already use Anki or AnkiDroid, with decks of every kind (languages, school, medicine),
often large and imported. They install a sideloaded APK. They study during the day on the phone or
the web, and every morning the alarm makes them answer cards before it stops.

## Product Purpose

An Android alarm clock you turn off by getting N flashcards right, and a full spaced-repetition app
around it: Anki-compatible decks, FSRS-6 scheduling, study on the phone and the web, `.apkg` import
and export, sync, and decks linked to AnkiDroid. Success is waking up having done your reviews,
without going back to sleep.

## Positioning

The alarm can't be dismissed without real recall: the cards come from your own Anki decks, every
answer is a real FSRS review, and an awake check catches anyone who falls back asleep. It's not a
puzzle alarm with throwaway math problems, and not another Anki client with a reminder.

## Operating Context

- The alarm screen is seen half asleep, often in a dark room, over the lock screen, with the sound
  still playing at a low level. Hands are clumsy and eyes may not be fully open.
- Cards are imported Anki HTML with their own CSS, rendered in a WebView on the phone and in the page
  on the web. Their look is the deck author's, not ours.
- Normal study and editing happen awake, on the phone or at a desk on the web.

## Capabilities and Constraints

- UI copy in pt-BR first, with a full English translation.
- Phone: react-native-reusables on uniwind. Web: shadcn on Base UI. Both read one CSS token package
  (`@app/design-tokens`), light and dark only. See `docs/research/design-tokens.md`.
- One shared visual identity on phone and web. No Material You dynamic color. Android conventions
  still apply to behavior: back gesture, system bars, haptics.
- The app's name isn't decided yet. Nothing may depend on a wordmark.
- Vocabulary: `GLOSSARY.md`.

## Brand Commitments

- Voice: firm and dry. Short, factual sentences, with no cheering and no guilt ("3 de 5. Próximo
  cartão.").

## Evidence on Hand

None yet: no screenshots, users or testimonials. Don't invent any.

## Product Principles

- The alarm is honest: it ends only on real recall, and it never lies about progress.
- Readable half asleep: the alarm screen works for someone who has barely opened their eyes.
- Anki's model is kept: imported decks look and behave as they do in Anki.
- The phone works fully offline, and an alarm never waits on the network.

## Accessibility & Inclusion

- The alarm screen must stay legible and operable with large system font scales and low vision
  without glasses, and with imprecise taps.
