import { Hono } from 'jsr:@hono/hono';
import { serveStatic } from 'jsr:@hono/hono/deno';

// 認証トークン（JWT）
import { jwt, sign, verify as verifyJwt } from 'jsr:@hono/hono/jwt'; // verifyをverifyJwtにリネームしてインポート
import { HTTPException } from 'jsr:@hono/hono/http-exception';

// クッキー
import { setCookie, deleteCookie, getCookie } from 'jsr:@hono/hono/cookie';

// パスワードのハッシュ化（bcrypt）
import { hash, verify } from 'jsr:@felix/bcrypt';

// サーバーの秘密鍵
const JWT_SECRET = Deno.env.get('JWT_SECRET');

// JWT用のクッキーの名前
const COOKIE_NAME = 'auth_token';

const app = new Hono();
const kv = await Deno.openKv();

/*
 * ユーザー認証
 */

/*** ユーザー登録 ***/
app.post('/api/signup', async (c) => {
  // 登録情報の取得
  const { username, password } = await c.req.json();
  if (!username || !password) {
    c.status(400); // 400 Bad Request
    return c.json({ message: 'ユーザー名とパスワードは必須です' });
  }

  // ユーザー名がすでにないか確認
  const userExists = await kv.get(['users', username]);
  if (userExists.value) {
    c.status(409); // 409 Conflict
    return c.json({ message: 'このユーザー名は既に使用されています' });
  }

  // パスワードをハッシュ化してユーザー名とともにデータベースに記録
  const hashedPassword = await hash(password);
  const user = { username, hashedPassword };
  await kv.set(['users', username], user);

  c.status(201); // 201 Created
  return c.json({ message: 'ユーザー登録が成功しました' });
});

/*** ログイン ***/
app.post('/api/login', async (c) => {
  // ログイン情報の取得
  const { username, password } = await c.req.json();
  const userEntry = await kv.get(['users', username]);
  const user = userEntry.value;

  if (!user) {
    c.status(401); // 401 Unauthorized
    return c.json({ message: 'ユーザー名が無効です' });
  }

  // ハッシュ化されたパスワードと比較
  if (!(await verify(password, user.hashedPassword))) {
    c.status(401); // 401 Unauthorized
    return c.json({ message: 'パスワードが無効です' });
  }

  // JWTの本体（ペイロード）を設定
  const payload = {
    sub: user.username, // ユーザー識別子（連番IDでもよい）
    // name: user.username,  // 表示用のユーザー名
    iat: Math.floor(Date.now() / 1000), // 発行日時
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24時間有効
  };

  // JWT（トークン）を生成
  const token = await sign(payload, JWT_SECRET);

  // JWTをHttpOnlyのクッキーに設定
  setCookie(c, COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: false, // 開発環境のためfalseにしているが本番環境ではtrueにする
    sameSite: 'Strict',
    maxAge: 60 * 60 * 24 // 24時間有効
  });

  // レスポンス
  return c.json({ message: 'ログイン成功', username: user.username });
});

/* 上記以外の /api 以下へのアクセスにはログインが必要 */
app.use('/api/*', jwt({ secret: JWT_SECRET, cookie: COOKIE_NAME }));
// ↑ここで照合に成功すると jwtPayload というキーにJWTのペイロード（本体）が記録される
// ↑ログインしていなければ「401 Unauthorized」が返される

/*** ログアウト ***/
app.post('/api/logout', (c) => {
  // JWTを含むクッキーを削除
  deleteCookie(c, COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: false, // ログイン時の設定に合わせる
    sameSite: 'Strict'
  });

  c.status(204); // 204 No Content
  return c.body(null);
});

/*** ログインチェック ***/
app.get('/api/check', async (c) => {
  const payload = c.get('jwtPayload');
  const username = payload.sub;
  return c.json({ username });
});

/*** API ***/
app.get('/api/questions', async (c) => {
  // ログインチェックはjwtミドルウェアによって既に実行済み
  try {
    const opentdbUrl = 'https://opentdb.com/api.php?amount=5&category=27&difficulty=medium&type=multiple&encode=base64';
    const res = await fetch(opentdbUrl);

    if (!res.ok) {
      throw new Error('OpenTDBからのデータ取得に失敗しました。');
    }

    const data = await res.json(); // 質問文と正解の文字列だけをデコードして抽出

    const decodedResults = data.results.map((q) => {
      return {
        // 質問文
        question: atob(q.question), // 正解の文字列をタイピングさせる
        answer: atob(q.correct_answer)
      };
    });

    return c.json(decodedResults);
  } catch (error) {
    console.error('取得エラー:', error);
    c.status(500);
    return c.json({ message: 'サーバー側で質問の取得に失敗しました。' });
  }
});

// スコア一覧取得用のAPI
app.get('/api/scores', async (c) => {
  const payload = c.get('jwtPayload');
  const username = payload.sub;
  const entries = await kv.list({ prefix: ['scores', username] });
  const history = [];
  for await (const entry of entries) history.push(entry.value);
  return c.json(history);
});

/* 連番のIDを生成する関数 */
async function getNextId() {
  const key = ['counter', 'scores'];
  const res = await kv.atomic().sum(key, 1n).commit();
  if (!res.ok) {
    console.error('IDの生成に失敗しました。');
    return null;
  }
  const counter = await kv.get(key);

  return Number(counter.value);
}

/*** スコアの保存 ***/
app.post('/api/scores', async (c) => {
  // JWTからユーザー名を取得
  const payload = c.get('jwtPayload');
  const username = payload.sub;

  // スコアデータの取得
  const { score, wpm, accuracy } = await c.req.json();
  if (score === undefined || wpm === undefined || accuracy === undefined) {
    c.status(400);
    return c.json({ message: 'スコアデータが不足しています。' });
  }

  // IDと生成時刻を生成してレコードに追加
  const scoreId = await getNextId();
  const record = {
    id: scoreId,
    username,
    score: score,
    wpm: wpm,
    accuracy: accuracy,
    createdAt: new Date().toISOString()
  };

  // リソースの作成 (キー: ['scores', ユーザー名, スコアID])
  await kv.set(['scores', username, scoreId], record);

  // レスポンスの作成
  c.status(201); // 201 Created

  return c.json({ message: 'スコアを保存しました。', record });
});

/*** ハイスコアランキングの取得 ***/
app.get('/api/scores/ranking', async (c) => {
  // 全ユーザーのスコアデータを取得し、ソートする
  const allScores = [];
  const iter = kv.list({ prefix: ['scores'] });
  for await (const entry of iter) {
    allScores.push(entry.value);
  } // WPM (Words Per Minute) の降順でソート

  allScores.sort((a, b) => b.wpm - a.wpm); // 上位10件を返す

  return c.json(allScores.slice(0, 10));
});

/*
 * ウェブサーバー
 */

// ログイン済みならリダイレクト
app.on('GET', ['/signup.html', '/login.html'], async (c, next) => {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    return c.redirect('/index.html'); // アプリページへリダイレクト
  }
  await next();
});

// 認証が必要なページへのアクセス制御（index -> login）
// `serveStatic`の前に配置し、HTMLファイルへのリクエストを検出する
app.on('GET', ['/', '/index.html'], async (c, next) => {
  const token = getCookie(c, COOKIE_NAME); // トークンが存在し、かつ有効なJWTであるか確認（簡易的な検証）
  let isAuthenticated = false;
  if (token && JWT_SECRET) {
    try {
      // ここでトークンの有効期限や署名を検証
      await verifyJwt(token, JWT_SECRET);
      isAuthenticated = true;
    } catch (_e) {
      // トークンが無効または期限切れの場合は、認証失敗とする
      deleteCookie(c, COOKIE_NAME, { path: '/', httpOnly: true, secure: false, sameSite: 'Strict' });
    }
  } // 認証されていない場合、ログインページへリダイレクト

  if (!isAuthenticated) {
    // ログアウト後にindex.htmlにアクセスしようとした場合もここでリダイレクト
    return c.redirect('/login.html');
  } // 認証済みの場合は次のミドルウェアへ
  await next();
});

// ウェブコンテンツ（静的ファイル）の置き場を指定
app.get('/*', serveStatic({ root: './public' }));

Deno.serve(app.fetch);
