# Airborne Tone Link - Send short text through sound and visualize the channel

![GitHub Repo stars](https://img.shields.io/github/stars/ipusiron/airborne-tone-link?style=social)
![GitHub forks](https://img.shields.io/github/forks/ipusiron/airborne-tone-link?style=social)
![GitHub last commit](https://img.shields.io/github/last-commit/ipusiron/airborne-tone-link)
![GitHub license](https://img.shields.io/github/license/ipusiron/airborne-tone-link)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-blue?logo=github)](https://ipusiron.github.io/airborne-tone-link/)

**Day120 - 200 Security Tools Created with Generative AI**

Airborne Tone Link is an educational tool that sends short text from a speaker to a microphone and displays the channel as a spectrogram.
Watch text become UTF-8 bytes, pairs of tones and decoded characters in audible and near-ultrasonic modes.
It does not encrypt messages. Anyone who knows the protocol and can receive the tones can decode them.

[日本語](README.md) / English

## 🌐 Demo

👉 **[Open Airborne Tone Link](https://ipusiron.github.io/airborne-tone-link/)**

No installation is needed. You can also download the files together and open `index.html` directly.
Microphone access requires browser permission. Public HTTPS or localhost is recommended; microphone access on `file://` varies between browsers.

## 📸 Screenshots

> ![Text input and UTF-8 byte preview](assets/send-en.png)
>
> *“HELLO日本語” occupies 14 UTF-8 bytes.*

> ![Transmit and receive spectrograms with shared axes](assets/spectrogram-en.png)
>
> *Outgoing waveform above, microphone input below, with shared axes. This screenshot uses a test-only virtual path.*

> ![Decoded result and mode comparison](assets/result-en.png)
>
> *A locally decoded WAV, with CRC, confidence and the time needed for 16 bytes.*

> ![Learning table showing the byte-to-tone mapping](assets/lesson-en.png)
>
> *The two frequencies for “A”. The learning section contains five topics.*

The four Japanese views appear in the [Japanese README](README.md).

## ✨ Features

- Split one byte into two 4-bit groups; select one tone from each of two separate 16-tone blocks
- Audible and Ultrasonic bands with independent common settings: 85/192ms tones and 1/2 full transmissions
- Send only, receive only, physical loopback and local WAV decoding
- A spectrogram focused on 32 data tones, with incremental UTF-8 decoding
- CRC-8, confidence and character agreement for loopback
- Reported microphone processing settings, Japanese/English, light/dark themes and keyboard controls

## 📖 Usage

### Send between two devices

1. Open the tool on both devices and select the same band and tone duration. Begin with Audible.
2. On the receiving device, select Receive only, start and allow microphone access.
3. On the sending device, select Send only and enter up to 16 UTF-8 bytes.
4. Lower the OS volume, then start. Check the receiver's text and CRC.
5. To try near-ultrasound, switch both devices to Ultrasonic.

`HELLO` is 5 bytes, `日本語` is 9 bytes and `😀😀😀😀` is 16 bytes.
Defaults are Audible, Short (85ms), and two full transmissions. Changing bands preserves duration and count. Some people can hear frequencies near 16kHz.
Avoid simultaneous transmitters. There is no automatic reply or retransmission request; switch roles to reverse the direction.

### Loop back on one device

Loopback uses the physical speaker-to-microphone path.
A short 1kHz self-check must rise at least 10dB above background before transmission starts.
Headphones may prevent the microphone from receiving the self-check.
If echo cancellation or noise suppression is on, the tool asks whether to continue. It displays reported settings, not requested values.

### Decode a WAV

Select Decode a WAV and load audio using this tool's frame format.
Supported files are PCM 16/24/32-bit or float 32-bit WAV, 8–96kHz, one or two channels, at most 12MiB and 60 seconds.
The selected band must be supported at the file's sample rate. Compressed WAV and WAVE_FORMAT_EXTENSIBLE are not supported.
Stereo channels are averaged, so opposite-phase audio can cancel out. Other modem protocols and speech are not decoded.

### Recovered text and successful reception

“Text recovered from sound” contains candidates read from the microphone in Receive or Loopback, the outgoing waveform in Send, or the selected WAV offline. The send text is never copied into this display. Partial text is unverified; CRC, end-marker and UTF-8 verification is reported separately.

If no payload byte is readable, the display says “No characters recovered.” A `?` marks an unreadable position, not an acquired character (unless the original text contains a `?`). Readable and unreadable byte counts are shown separately. Stopping preserves partial candidates as unverified; changing the mode or role clears previous results.

The graph spans 12 seconds. The selected duration and count determine how much unmeasured time remains on the right. Both bands take the same time with equal settings. “No samples” does not mean measured silence or reception failure. A frame that could not be read to the end may still contain partial candidates.

Offline decoding creates neither microphone input nor audio output. The file stays local; its selection and analysis data are released when decoding finishes or stops.
The tool has no recording or audio-download feature.

### Compare transmitted and received sound

The default Loopback role shows the outgoing waveform above and microphone input below. Separate analyzers measure the two paths on the same time, frequency and color scales. The output is never wired directly into the receiver. The upper plot measures the digital waveform passed to the speaker, not sound emitted into the air. Their difference is not a calibrated attenuation measurement.

To compare frequency bands, keep duration, count, message, volume and device positions equal. With Short tones and two transmissions, `HELLO` takes 2.960 seconds in either band. Reception delays also appear on the shared time axis.

Send only measures the upper plot; Receive only measures the lower plot. Check the transmitting device for its own outgoing waveform. WAV data appears below. Select the duration used by the sender when receiving or decoding WAVs. Older audible WAVs use Long (192ms). The count is a sender setting; Receive only stops at the first valid frame.

## 🎯 Use cases

### Uses specific to this tool

| Question | Action and example |
|---|---|
| Does character count equal communication size? | `HELLO` has 5 characters and 5 bytes; `日本語` has 3 characters and 9 bytes. Compare their transmission times |
| What happens when a character repeats? | `AAAA` repeats 1,876Hz and 3,098Hz. A synchronized clock still reads four separate bytes |
| Which missing tone prevents decoding? | Change device direction or distance and inspect both blocks. One block alone leaves four bits unknown, producing “?” |
| What does a speed figure count? | With defaults, either band takes 4.830 seconds for 16 bytes, or 3.31B/s net. Compare with 5.88B/s excluding framing |
| Is communication the same as secrecy? | Decode a public message with another receiver. CRC success does not imply encryption or sender authentication |

In a class or exhibit, explain the mechanism in audible mode before moving to near-ultrasound.
A WAV with the same frame format lets you inspect decoding independently of the room and physical device path.

## 🔬 Protocol and decisions

| Item | Value |
|---|---|
| Encoding and limit | UTF-8, 16 bytes |
| Tones | High nibble in block A, low nibble in block B; 32 candidates total |
| Tone spacing | 94Hz, approximately four bins at 48kHz with FFT 2048 |
| Data-band span | 2,914Hz across 31 intervals; markers at F0−188Hz and F0−94Hz |
| Frame | 4 alternating markers, 1 length byte, 0–16 payload bytes, 1 CRC byte, 2 end markers |
| CRC | CRC-8/SMBUS: polynomial 0x07, initial value 0, no reflection, final XOR 0; covers length and payload |
| FFT | 2048 samples, Blackman window, no smoothing; maximum power within ±1 bin of each candidate |
| Confidence | Ratio between the largest and second-largest candidate powers; both blocks must reach 6dB; display the lower value |
| Output | Calculated sine-wave AudioBuffer, 6ms edge ramps, default −30dBFS, maximum −12dBFS |

For `HELLO`, payload bytes are `48 45 4C 4C 4F`, length is `05` and CRC is `B8`.
`A` (`41`) maps to 1,876Hz and 3,098Hz in audible mode.
After the preamble, the decoder uses a fixed symbol clock, including for identical consecutive bytes.
Markers sit below the data band and are not among the 32 spectrogram rows.

Spectrogram shading represents relative FFT power from −100 to −20dB, not sound pressure.
Outlines also identify the last recognized tone pair. The plot covers the latest 12 seconds.
Reduced-motion preferences limit painting to four times per second without changing demodulation timing.
Multibyte UTF-8 characters appear once their required bytes arrive.

CRC detects errors without correcting them. The decoder also validates end markers and UTF-8.
Confidence is not a probability, and CRC cannot prove integrity or sender identity.
Loopback agreement compares Unicode code points at equal positions, using the longer character count as the denominator.
Receive only, WAV decoding and Send only do not display agreement because they lack an independent expected message.

### Values confirmed with OfflineAudioContext

We checked 72 conditions in Chromium and Firefox at 44.1/48kHz.
Eight amplitude checks covered 34 frequencies with an independent sine/cosine least-squares fit; the maximum deviation from −30dBFS was below 0.000001dB.
Sixty-four decoding checks combined 44.1/48kHz transmit and receive rates, both bands, both durations and both counts, using native resampling and an independent FFT to recover `HELLO日本語` and its CRC.
These measurements support F0=1,500/16,000Hz, 94Hz spacing and common 85/192ms symbols with 1/2 transmissions.
They validate software waveforms, not physical high-frequency response or transmission distance.

## ⏱️ Transfer-rate limits

Comparison with default Short (85ms) tones and two full transmissions. Frequency band and timing are independent.

| Item | Audible | Ultrasonic (advanced) |
|---|---:|---:|
| F0 | 1,500Hz | 16,000Hz |
| Data band | 1,500–4,414Hz | 16,000–18,914Hz |
| Symbol duration | 85ms | 85ms |
| Full transmissions | 2 | 2 |
| With repeats, without framing | 5.88B/s | 5.88B/s |
| Time for 16 bytes | 4.830s | 4.830s |
| Net rate for 16 bytes | 3.31B/s | 3.31B/s |

| Common settings | With repeats, without framing | Time for 16 bytes | Net rate for 16 bytes |
|---|---:|---:|---:|
| Short 85ms, once | 11.76B/s | 2.540s | 6.30B/s |
| Short 85ms, twice (default) | 5.88B/s | 4.830s | 3.31B/s |
| Long 192ms, once | 5.21B/s | 5.108s | 3.13B/s |
| Long 192ms, twice | 2.60B/s | 9.966s | 1.61B/s |

B means bytes. The rate including repeats but excluding framing is `1 / (symbol duration × transmission count)`.
For payload length L, symbol duration T and transmission count R, waveform duration is `0.5 + (L + 8) × T × R + 0.25 × (R − 1)` seconds.
This includes 250ms leading/trailing silence and a 250ms repeat gap. Permission time, self-check and device/OS latency are excluded.
Treating “about 2.5B/s” or “about 12B/s” as complete-frame throughput overstates the result.

This implementation leaves enough time for a stable 2048-sample window, about 42.7ms at 48kHz, and uses 94Hz spacing to separate candidates.
Shorter symbols are more sensitive to echoes and scheduling delays; wider tone spacing uses more bandwidth.
Background noise, high-frequency attenuation, microphone processing and device variation reduce reception margin.
Higher frequencies alone do not make the protocol faster.

[The ggwave author's documentation](https://github.com/ggerganov/ggwave#details) reports 8–16B/s.
ggwave uses six simultaneous tones for three bytes and Reed–Solomon error correction.
This tool uses two simultaneous tones for one byte and CRC only; the protocols are incompatible.
It implements the processing in classic scripts without compiled ggwave/quiet components, preserving the restrictive CSP and `file://` operation.

## 🔄 Comparison with other air-gap channels

Distances below are laboratory reports involving particular equipment, line of sight or favorable conditions.
Maximum rate and maximum distance need not occur together. Countermeasures summarize ways to reduce a path, not guaranteed protection.

| Path and method | Rate and receiver | Distance and conditions | Example countermeasures | Source |
|---|---|---|---|---|
| Acoustic: this tool | 3.31B/s by default (1.61–6.30B/s across settings), 16 bytes; microphone | Physical range unmeasured | Disable unnecessary audio input/output; control receiving devices | Implementation and calculations above |
| Optical: LED-it-GO | Up to 4000bit/s with a photodiode; 15–120bit/s with cameras | Optical sensor: 3–5m indoors; signals observed at 20m outdoors at night; camera example at 8m | Cover LEDs; restrict cameras | [Author paper](https://arxiv.org/pdf/1702.06715), Table 7 and distance section |
| Magnetic: MAGNETO | 0.2–5bit/s; smartphone magnetometer | 0–12cm, desktop PCs | Control nearby devices; increase separation | [Author paper](https://arxiv.org/pdf/1802.02317), Table 1 |
| Magnetic: ODINI | 40bit/s; dedicated magnetic sensor | 100–150cm | Restrict receivers; address magnetic emissions | [Via MAGNETO Table 1](https://arxiv.org/pdf/1802.02317); original paper not directly verified |
| Thermal: BitWhisper | 1–8bit/hour; another PC's built-in thermal sensors; bidirectional | 0–40cm | Device separation; thermal isolation | [Author paper](https://arxiv.org/abs/1503.07919) |
| Electromagnetic: AirHopper | 13–60B/s (104–480bit/s); FM-capable phone | 1–7m | Control receivers; address electromagnetic emissions | [BGU researcher description](https://cyber.bgu.ac.il/how-leak-sensitive-data-isolated-computer-air-gap-near-mobile-phone-airhopper/) |
| Power: PowerHammer | Line-level 1000bit/s; phase-level 10bit/s; current probe | Depends on electrical tap location; no single range in meters | Control access to wiring; power-line monitoring/filtering | [Author paper](https://arxiv.org/abs/1804.04014) |

The arXiv links are author-posted versions; arXiv hosting alone is not evidence of peer review.
ODINI values are a secondary citation within MAGNETO, distinguished from direct verification of the original paper.
Do not treat ggwave anecdotes or other acoustic research ranges as measurements of this tool.
We also omit the unverified “about 2m” distance sometimes attributed to Arp et al.'s 2017 ultrasonic-beacon research.

## 📚 Connection to the Air-Gap Bridge books

This is a companion exercise for considering the two directions covered by the books: input into an isolated environment and output from it.
Explore short text becoming characters at the receiver and bytes becoming tones at the sender.

- [Air-Gap Bridge: Data Input Techniques for Isolated Environments — book information](https://akademeia.info/?page_id=53563)
- [Air-Gap Bridge: Data Output Techniques for Isolated Environments — book information](https://akademeia.info/?page_id=53554)

See the linked book pages for the current contents. No book text is quoted or reproduced.

## 🔒 Privacy and safety

- No recording, persisted messages or network transmission. Only language and theme preferences use localStorage
- Send only never opens a microphone. Reception lasts at most 60 seconds. Finite transmission buffers stop automatically
- Stop, hiding/leaving the page, Help, microphone mute/end and audio-context interruptions end the session
- Unmuting does not resume automatically; start again explicitly
- No external scripts, fonts or CDN; user text is displayed with textContent
- The −12dBFS cap limits digital amplitude, not physical sound pressure

GitHub Pages does not support arbitrary response headers. The specified meta CSP applies, but X-Frame-Options protection against embedding is not provided.

Begin with low OS volume, consider people and pets nearby, and stop if uncomfortable.
This is not intended to expose people to sound and is not a medical device.
IPUSIRON writes technical books on security and does not encourage misuse. Use it where participants can understand and consent.

## 🔗 Related tools and primary sources

- [Day119 Ultrasonic Reach Meter](https://ipusiron.github.io/ultrasonic-reach-meter/): test conditions under which near-ultrasonic output reaches a microphone
- [Day041 Mic Gain Logger](https://ipusiron.github.io/mic-gain-logger/): observe microphone energy by frequency band over time
- [ggwave](https://github.com/ggerganov/ggwave): four-bit frequency allocation, markers and error correction
- [Web Audio API, W3C](https://www.w3.org/TR/webaudio-1.0/): AudioBufferSourceNode, AnalyserNode, FFT and windowing
- [FTC Silverpush warning, 2016](https://www.ftc.gov/news-events/news/press-releases/2016/03/ftc-issues-warning-letters-app-developers-using-silverpush-code): public guidance concerning user notice

Power calculations and audio handling draw from Day119; the single-page structure and palette draw from Day118.
Both are MIT-licensed code by the same author.

## 🧪 Tests

Use Node.js 22 or later. No package installation is needed.

```sh
npm test
```

Tests cover encoding, CRC, synchronization, missing tones, 44.1/48kHz bin offsets, agreement, interruption/cleanup, malformed WAVs, independent DFT comparison, README values, CSP, dictionaries and contrast.
CI runs syntax checks and tests on push and pull_request.
Browser checks use Chromium's fake WAV microphone to verify actual waveform decoding, incremental text, CRC and input cleanup.
Automated loopback uses a test-only virtual path; it does not establish physical speaker-to-microphone delivery.

## 📁 Directory structure

```text
airborne-tone-link/
├── index.html                  # Single page and five learning topics
├── style.css                   # Themes, responsive layout and color tokens
├── codec-core.js               # Encoding, sync, CRC, pure FFT and WAV parser
├── audio-io.js                 # Audio input/output, stopping and WAV progress
├── messages.js                 # Japanese and English dictionaries
├── app.js                      # Controls, results and spectrogram
├── assets/                     # Four PNG states in each language (eight total)
├── test/                       # node:test
│   ├── codec.test.js           # Encoding, synchronization, decisions, agreement
│   ├── audio.test.js           # Graphs, interruptions and resource cleanup
│   ├── app-state.test.js       # Recovered candidates, missing data, verification and reset
│   ├── offline.test.js         # Independent DFT, WAV and actual PCM decoding
│   ├── structure.test.js       # CSP, contrast, dictionaries and formatting
│   └── readme.test.js          # Metadata, examples, rates, sources and images
├── .github/workflows/test.yml  # Node 22 checks on push and pull requests
├── package.json                # Dependency-free test command
├── .gitignore                  # Local generated-file exclusions
├── .nojekyll                   # Static Pages delivery
├── README.md                   # Japanese documentation
├── README.en.md                # English documentation
├── CLAUDE.md                   # Development invariants
└── LICENSE                     # MIT License
```

## 💻 Environment and verification scope

Automated checks cover real-time audio in Chromium/Firefox and WAV decoding/layout in Chromium/Firefox/Windows WebKit.
The matrix includes HTTP, `file://`, widths of 320/390/1280px, both languages, both themes and focus restoration after Help.
The Windows WebKit test port lacks live audio APIs and is not a substitute for physical Safari testing.

Unverified areas include two physical devices, room echoes, hardware high-frequency response, Bluetooth routes, iPhone/Mac Safari, actual sound levels and range.
Where AudioSession is available, microphone roles request `play-and-record`; Send only requests `playback`.
A mode is rejected when its highest tone exceeds 0.45 times the analysis sample rate or its FFT window cannot fit.
Physical frequencies stay fixed between devices; FFT bins are calculated from the actual analysis rate.

## 📄 License

[MIT License](LICENSE). There are no npm runtime or development dependencies.

## 🛠️ About this tool

This tool is part of the “200 Security Tools Created with Generative AI” project.
The project uses AI assistance to create and publish security-related tools over 100 days.

For details and other tools, visit:

🔗 [200 Security Tools Created with Generative AI](https://akademeia.info/?page_id=44607)
