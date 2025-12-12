// ===================================
// 認証・ユーザー情報関連
// ===================================
document.addEventListener('DOMContentLoaded', async () => {
  // ログインユーザー情報の取得
  try {
    const res = await fetch('/api/check');
    if (res.ok) {
      const data = await res.json();
      document.getElementById('username-display').textContent = `ようこそ、${data.username}さん`;
    } else {
      // 認証されていない場合は、server.jsでlogin.htmlにリダイレクトされる想定
      console.warn('ユーザー情報が取得できませんでした。');
    }
  } catch (error) {
    console.error('ログインチェックエラー:', error);
  }

  // ログアウト処理
  document.getElementById('logout-button').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/logout', { method: 'POST' });
      if (res.ok) {
        location.href = 'login.html';
      } else {
        alert('ログアウトに失敗しました。');
      }
    } catch (error) {
      console.error('ログアウトエラー:', error);
      alert('ログアウト処理中にエラーが発生しました。');
    }
  });

  // ランキングの読み込み
  loadRanking();
});

async function loadRanking() {
  const rankingTableBody = document.querySelector('#ranking-table tbody');
  const rankingStatus = document.getElementById('ranking-status');
  const rankingTable = document.getElementById('ranking-table');

  rankingStatus.textContent = 'ランキングを読み込み中...';
  rankingTableBody.innerHTML = '';
  rankingTable.classList.add('hidden');

  try {
    const res = await fetch('/api/scores/ranking');
    if (res.ok) {
      const rankingData = await res.json();
      rankingStatus.classList.add('hidden');
      rankingTable.classList.remove('hidden');

      if (rankingData.length === 0) {
        rankingStatus.textContent = 'まだスコアがありません。';
        rankingStatus.classList.remove('hidden');
        rankingTable.classList.add('hidden');
        return;
      }

      rankingData.forEach((score, index) => {
        const row = rankingTableBody.insertRow();
        row.insertCell().textContent = index + 1;
        row.insertCell().textContent = score.username;
        row.insertCell().textContent = score.wpm.toFixed(0);
        row.insertCell().textContent = `${score.accuracy.toFixed(2)}%`;
        row.insertCell().textContent = score.score.toFixed(0);
      });
    } else {
      rankingStatus.textContent = 'ランキングの取得に失敗しました。';
    }
  } catch (error) {
    console.error('ランキング取得エラー:', error);
    rankingStatus.textContent = 'ランキングの取得中にエラーが発生しました。';
  }
}

// ===================================
// タイピングゲームロジック
// ===================================
const startButton = document.getElementById('start-button');
const questionArea = document.getElementById('question-area');
const statsArea = document.getElementById('stats-area');
const displayText = document.getElementById('display-text');
const inputField = document.getElementById('input-field');

let questions = []; // 取得した問題リスト (questionとanswerを含む)
let currentQuestionIndex = 0; // 現在の問題番号

// *** 変更点1: currentTextをcurrentAnswerに変更し、正解文字列を保持する ***
let currentAnswer = ''; // 現在の正解文字列
let expectedKey = ''; // 次に入力すべき文字
let startTime = 0; // 開始時刻
let timerInterval = null; // タイマー

// *** 変更点2: ゲーム全体の入力統計情報を保持する変数はそのまま ***
let correctChars = 0; // 正しく入力した文字数 (全問題合計)
let totalChars = 0; // 総入力文字数（間違いを含む、全問題合計）

// 状態表示要素
// ... (状態表示要素の定義は変更なし) ...
const timerDisplay = document.getElementById('timer');
const wpmDisplay = document.getElementById('wpm-display');
const correctCountDisplay = document.getElementById('correct-count');
const totalCountDisplay = document.getElementById('total-count');
const accuracyDisplay = document.getElementById('accuracy-display');

// ゲームスタート
startButton.addEventListener('click', async () => {
  // ... (問題取得とゲーム初期化のコードは変更なし) ...
  startButton.disabled = true;
  startButton.textContent = '問題を読み込み中...';

  try {
    const res = await fetch('/api/questions');
    if (!res.ok) {
      throw new Error('質問の取得に失敗しました。');
    }
    questions = await res.json();

    if (questions.length === 0) {
      alert('問題が取得できませんでした。');
      return;
    }

    // ゲーム初期化
    currentQuestionIndex = 0;
    correctChars = 0;
    totalChars = 0;
    startTime = Date.now();
    clearInterval(timerInterval);

    // UI表示
    startButton.classList.add('hidden');
    questionArea.classList.remove('hidden');
    statsArea.classList.remove('hidden');
    inputField.disabled = false;
    inputField.focus();

    // 最初の問題を表示
    showNextQuestion();

    // タイマー開始
    timerInterval = setInterval(updateStats, 1000);
  } catch (error) {
    console.error('ゲーム開始エラー:', error);
    alert('ゲームの開始中にエラーが発生しました。');
    startButton.disabled = false;
    startButton.textContent = 'ゲームスタート';
  }
});

// 次の問題を表示する (大幅変更)
function showNextQuestion() {
  if (currentQuestionIndex >= questions.length) {
    // 全問終了
    endGame();
    return;
  }

  const currentQ = questions[currentQuestionIndex];

  // *** 変更点3: displayTextには質問文を表示する ***
  const rawQuestion = currentQ.question;
  const decodedQuestion = decodeHtmlEntities(rawQuestion);

  // *** 変更点4: currentAnswerに正解文字列を格納する ***
  currentAnswer = decodeHtmlEntities(currentQ.answer);

  // 質問文を単なるテキストとして表示
  displayText.innerHTML = `<p>${decodedQuestion}</p>`;

  // 入力フィールドをクリア
  inputField.value = '';

  // ユーザーにタイピングすべき文字の長さを示唆するために、
  // 入力フィールドのプレースホルダーを正解の文字数分のアンダーバーで表示
  inputField.placeholder = currentAnswer
    .split('')
    .map(() => '_')
    .join(' ');

  // 最初の文字をハイライト (今回は入力フィールドの文字と正解の文字を比較するため、
  // displayText の文字をハイライトする必要はない)
  // ただし、入力フィードバックは実装しないと難しすぎるため、入力した文字と比較する方法に変更する

  // *** 変更点5: Input Event Listener側で文字単位のフィードバックロジックを変更する ***
}

// 入力イベントの処理 (大幅変更)
inputField.addEventListener('input', (e) => {
  const inputText = inputField.value;
  const currentLength = inputText.length;
  const answerLength = currentAnswer.length;

  // 入力文字数が増えた場合のみ totalCharsをカウントアップ（文字削除はカウントしない）
  if (currentLength > inputField.dataset.prevLength) {
    totalChars++;
  }
  inputField.dataset.prevLength = currentLength; // 以前の長さを保存

  // フィードバック表示をリセットし、現在入力されている文字に基づいて再構築
  let feedbackHTML = '';
  let currentCorrectChars = 0;

  for (let i = 0; i < answerLength; i++) {
    const expectedChar = currentAnswer[i];
    let charSpan = `<span class="placeholder">${expectedChar}</span>`; // デフォルト（未入力部分）

    if (i < currentLength) {
      const inputChar = inputText[i];

      if (inputChar === expectedChar) {
        // 正解
        charSpan = `<span class="correct">${inputChar}</span>`;
        currentCorrectChars++;
      } else {
        // 不正解
        charSpan = `<span class="incorrect">${inputChar}</span>`;
      }
    }

    feedbackHTML += charSpan;
  }

  // Q&A表示の下に入力フィードバック専用のエリアを作成する (index.htmlも修正が必要)
  // 一時的に displayText にフィードバックを表示させる
  // (displayText には既に質問文が表示されているため、これは望ましくない。
  // index.html に #feedback-text エリアが必要)

  // *** index.htmlに #feedback-text を追加する前提で、ここでフィードバックを行うと仮定 ***
  // 既存の displayText にフィードバックも表示すると質問文が消えてしまうので、
  // ここでは、一旦ロジックに集中し、全入力文字数と正解文字数の比較を行う

  // *** 既存のロジックとの整合性を取るため、全文字数と正解文字数のカウントを行う ***
  // (ここでは、今回の入力における正誤判定ではなく、全体の統計情報を更新)

  // 正しく入力した文字数(correctChars)は、**ゲーム開始後**からの累計であるため、
  // ここで直接更新するのは難しい。→ 全問終了時にのみスコア計算を行う。
  // *一旦、正解を最後まで入力したときのみ、次の問題に進む簡単なロジックを採用します。*

  if (currentLength > 0 && currentLength <= answerLength) {
    // 現在の問題の正解文字数を一時的にカウント
    const lastInputChar = inputText[currentLength - 1];
    const expectedChar = currentAnswer[currentLength - 1];

    if (lastInputChar === expectedChar) {
      // 正解
      if (currentLength > inputField.dataset.lastCorrect) {
        // 新しい文字が正しく入力された場合のみ、累積正解文字数を増やす
        correctChars++;
        inputField.dataset.lastCorrect = currentLength;
      }
    } else {
      // 不正解 (何もしない、totalCharsは既に増えている)
      inputField.dataset.lastCorrect = currentLength - 1; // 間違えたら正解文字数はリセット
    }
  }

  // 全て入力が完了し、かつ正解しているかチェック
  if (currentLength === answerLength) {
    if (inputText === currentAnswer) {
      alert(`✅ 正解！次の問題へ`);
      currentQuestionIndex++;

      // 次の問題を少し遅延させて表示
      setTimeout(showNextQuestion, 100);
      return;
    } else if (currentLength > answerLength) {
      // 入力が正解を超えたら、それ以上入力できないようにする
      inputField.value = currentAnswer;
    }
  }

  // 統計情報の更新
  updateStats();
});

// 次に入力すべき文字をハイライト (この関数はAnswerタイピング形式では使われない)
function highlightNextChar(index) {
  // Answerタイピング形式では使用しないため、空にするか削除する
}

// 統計情報を更新し、ゲームが終了した場合はスコアを送信
function updateStats() {
  // ... (元の updateStats 関数は変更なし) ...
  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  const accuracy = totalChars > 0 ? (correctChars / totalChars) * 100 : 0;

  // WPM: 5文字を1ワードとして、経過秒数から計算 (WPM = (正解文字数 / 5) / (経過時間 / 60))
  const wpm = elapsedSeconds > 0 ? correctChars / 5 / (elapsedSeconds / 60) : 0;

  // UI更新
  timerDisplay.textContent = elapsedSeconds;
  wpmDisplay.textContent = wpm.toFixed(0);
  correctCountDisplay.textContent = correctChars;
  totalCountDisplay.textContent = totalChars;
  accuracyDisplay.textContent = `${accuracy.toFixed(2)}%`;
}

// ゲーム終了処理
async function endGame() {
  // ... (元の endGame 関数は変更なし) ...
  clearInterval(timerInterval);
  inputField.disabled = true;

  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  const accuracy = totalChars > 0 ? (correctChars / totalChars) * 100 : 0;
  const wpm = elapsedSeconds > 0 ? correctChars / 5 / (elapsedSeconds / 60) : 0;
  const score = correctChars * 10 - (totalChars - correctChars) * 5;

  alert(`🎉ゲーム終了🎉\nスコア: ${score.toFixed(0)}\nWPM: ${wpm.toFixed(0)}\n正答率: ${accuracy.toFixed(2)}%`);

  // スコアをサーバーに保存
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        score: score,
        wpm: wpm,
        accuracy: accuracy
      })
    });

    if (res.ok) {
      console.log('スコア保存成功');
      loadRanking(); // ランキングを更新
    } else {
      const data = await res.json();
      console.error('スコア保存失敗:', data.message);
    }
  } catch (error) {
    console.error('スコア送信エラー:', error);
  }

  // ゲームリセットのためのUI
  startButton.classList.remove('hidden');
  startButton.textContent = 'もう一度プレイ';
  startButton.disabled = false;
}

// HTMLエンティティデコード関数
function decodeHtmlEntities(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return doc.documentElement.textContent;
}
