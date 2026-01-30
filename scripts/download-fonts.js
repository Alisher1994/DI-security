
import https from 'https';
import fs from 'fs';
import path from 'path';

const fonts = [
    {
        url: 'https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Bold.ttf',
        dest: 'fonts/Roboto-Bold.ttf'
    },
    {
        url: 'https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Regular.ttf',
        dest: 'fonts/Roboto-Regular.ttf'
    }
];

if (!fs.existsSync('fonts')) {
    fs.mkdirSync('fonts');
}

async function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                download(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✅ Downloaded: ${dest}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

async function run() {
    for (const font of fonts) {
        try {
            await download(font.url, font.dest);
        } catch (err) {
            console.error(`❌ Error downloading ${font.dest}:`, err.message);
        }
    }
}

run();
