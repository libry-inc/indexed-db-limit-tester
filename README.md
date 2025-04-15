Gemini Advanced 2.5 Pro Experimental を使って生成しました

サイト
https://libry-inc.github.io/indexed-db-limit-tester/

以下、プロンプト

---

# IndexedDB 容量上限確認ツール 仕様書に基づくコード生成プロンプト

以下の仕様書に基づいて、IndexedDB の各種上限を確認するための Web ページを作成してください。出力は HTML、CSS、JavaScript の 3 つのコードブロックに分けてください。外部ライブラリは使用せず、バニラ JavaScript で実装してください。

## 1. 概要

このツールは、ブラウザの IndexedDB に関する以下の項目を確認するための Web ページです。

* 総容量の上限
* 1 つの Key-Value ペアとして格納できるデータサイズの上限
* 1 つのオブジェクトストアに格納できるデータ件数の上限
* 現在のストレージ使用量と割り当て量 (Storage API)
* ストレージの永続化設定 (Storage API)

## 2. 機能要件

### A. 容量上限の確認 (テスト 1)

* **目的:** IndexedDB に格納できる総容量のおおよその上限を測定する。
* **方法:**
    * 1 回あたり 10 MiB (10 \* 1024 \* 1024 Bytes) のテストデータ（'a'の繰り返し文字列）を生成する。
    * 生成したデータを一意なキーと共に、専用のオブジェクトストア (`capacityStore`) に `addData` を使用して繰り返し追加する。
    * 追加処理をループし、格納に失敗 (特に `QuotaExceededError`) するか、合計格納量が 3 GiB (3 \* 1024 MiB) に達したらテストを終了する。
* **UI:**
    * テスト開始ボタンを設置する。
    * テストの進行状況（現在までに追加成功した合計 MiB 数）をプログレスバーで表示する (最大値は 3072 MiB)。
    * テストの進行状況（試行回数、追加成功/失敗、合計容量）と最終結果（推定上限容量または目標達成）を指定の `div` (`#capacityResult`) にログ出力する。
* **確認ダイアログ:** 試行（データ追加）回数が 100 回ごとに、ユーザーにテストを続行するか確認するダイアログを表示する。ユーザーがキャンセルした場合はテストを中断する。

### B. 単一 Key-Value データ上限の確認 (テスト 2)

* **目的:** 1 つのキーに対して格納できる値の最大データサイズを測定する。
* **方法:**
    * 指数関数的増加 + 二分探索アルゴリズムを用いる。
    * **指数関数的増加フェーズ:** 1 MiB から開始し、格納に成功するたびに試行サイズを 2 倍にしていく (`putData` で固定キー `single_item_test_key` に上書き)。
    * **二分探索フェーズ:** 格納に失敗した場合、最後に成功したサイズと失敗したサイズの間で二分探索を行い、上限値を 1 MiB 程度の精度で特定する。データ生成に失敗した場合も同様に二分探索へ移行する。
    * **目標達成:** 実際に 300 MiB 以上のデータ格納に **成功** した場合、テストは成功として終了する（途中の試行サイズが目標を超えただけでは終了しない）。
* **UI:**
    * テスト開始ボタンを設置する。
    * テストの進行状況（現在試行中のデータサイズ MiB 数）をプログレスバーで表示する (最大値は 300 MiB)。
    * テストの進行状況（試行回数、フェーズ、試行サイズ、成功/失敗）と最終結果（推定上限サイズまたは目標達成）を指定の `div` (`#singleSizeResult`) にログ出力する。
* **確認ダイアログ:** 試行（データ格納試行）回数が 10 回ごとに、ユーザーにテストを続行するか確認するダイアログを表示する。ユーザーがキャンセルした場合はテストを中断する。

### C. 単一ストア データ件数上限の確認 (テスト 3)

* **目的:** 1 つのオブジェクトストアに格納できるレコード（Key-Value ペア）の最大件数を測定する。
* **方法:**
    * 小さな固定データ (`{ d: "item_..." }` 等) を使用する。
    * 最初は一度に追加する件数（バッチサイズ）を指数関数的に増やす (100件 -> 1000件 -> 10000件...)。追加は単一トランザクションで行うヘルパー関数 (`addBatchData`) を使用する。
    * バッチ追加に失敗した場合、最後に成功した総件数から 1 件ずつ `addData` で追加していき、エラーが発生する直前の件数を上限とする。
    * 合計件数が 10,000 件を超えた時点でテストは成功として終了する（ただし、上限特定のために処理は続行してもよい）。安全のため、目標件数を大幅に超えた場合 (例: 目標の10倍) はテストを打ち切る。
* **UI:**
    * テスト開始ボタンを設置する。
    * テストの進行状況（現在までに追加成功した合計件数）をプログレスバーで表示する (最大値は 10000 件以上を設定)。
    * テストの進行状況（フェーズ、バッチ/単一追加、成功/失敗、合計件数）と最終結果（推定上限件数または目標達成）を指定の `div` (`#countResult`) にログ出力する。
* **確認ダイアログ:** このテストでは**表示しない**。

### D. 現在の容量確認

* `navigator.storage.estimate()` API を使用して、現在の IndexedDB の使用量 (`usage`, `usageDetails`) と割り当て量 (`quota`) を取得し、整形して指定の `div` (`#storageResult`) に表示する。
* API がサポートされていない場合は、その旨を表示する。
* 合わせて `navigator.storage.persisted()` を使用し、現在の永続化状態も表示する。

### E. データの永続化設定

* `navigator.storage.persisted()` で現在の状態を確認する。
* 永続化されていない場合、`navigator.storage.persist()` API を使用してデータの永続化をリクエストする。
* リクエストの成否と、リクエスト後の永続化状態を指定の `div` (`#persistResult`) に表示する。
* API がサポートされていない場合は、その旨を表示する。

### F. テストデータの削除

* このツールが作成した IndexedDB データベース (`IndexedDBLimitTesterDB`) 全体を削除するボタン (`#clearDbBtn`) を設置する。
* 削除の成否を指定の `div` (`#clearDbResult`) に表示する。
* 削除前に実行中のテストがあれば中断を試みる。

## 3. 技術仕様

* **言語:** HTML, CSS, JavaScript (ES6+)
* **ライブラリ:** なし (バニラ JavaScript)
* **主要 API:**
    * IndexedDB API (基本的な Open, Add, Put, Clear, Delete Database 操作)
    * Storage API (`navigator.storage.estimate()`, `navigator.storage.persist()`, `navigator.storage.persisted()`)
* **データ生成:** 指定されたサイズの 'a' という文字の繰り返し文字列を生成するヘルパー関数 (`createData`) を用意する。データ生成時のエラーも考慮する。
* **エラー処理:** 各操作 (DB操作, API呼び出し, データ生成) で発生したエラーはコンソールに出力し、関連する UI の結果表示エリアにも分かりやすく表示する。
* **中断処理:**
    * `AbortController` が**利用できない環境**も考慮し、単純な boolean フラグ (`isTestRunning`, `testAborted`) を用いてテストの中断を管理する。
    * `beforeunload` イベントで、テスト実行中にページを離れようとした場合に警告を表示する。
    * `unload` イベントで、実行中のテストがあれば中断フラグを立てる（ベストエフォート）。
    * `confirm` ダイアログでキャンセルされた場合も中断フラグを立てる。
* **非同期処理:** Promise と `async/await` を適切に使用して非同期処理を管理する。

## 4. UI/UX 要件

* 各機能に対応するボタンと結果表示用の `div` を用意する。
* 結果表示用の `div` (`.result-area`) は、内容が指定した最大高さを超えた場合に縦スクロールバーが表示されるように CSS (`max-height`, `overflow-y: auto`) を設定する。
* ログ出力関数 (`log`) は、結果表示エリアがすでにユーザーによってスクロールされている場合、強制的に最下部へスクロールしないようにする。
* ログ出力関数 (`log`) は、結果表示エリア内のログ件数が一定数（例: 200件）を超えたら古いものから削除する機能を持つ（パフォーマンスのため）。
* 各テストの進行状況を示す `<progress>` 要素を設置する。
* ボタンはテスト実行中に無効化 (`disabled`) する。

## 5. コード構成

* HTML (`index.html`), CSS (`style.css`), JavaScript (`script.js`) の3つのファイルに分離することを想定したコードブロックを生成する。

---
