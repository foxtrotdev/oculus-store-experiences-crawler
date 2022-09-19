const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer');

const sqlite3 = require('sqlite3').verbose();
const TelegramBot = require('node-telegram-bot-api');

/**
 * Telegram bot token.
 * @type {string}
 */
const TELEGRAM_BOT_TOKEN = 'XXXXXXXXXXXXXXXXX';

/**
 * Default await time before next action.
 * The more seconds, the weaker the machine and internet connection.
 * @type {number}
 */
const WAIT_FOR_DELAY_MS = 5_000

/**
 * ID of Telegram's channel.
 * @type {string}
 */
const TELEGRAM_CHANNEL_ID = "@XXXXXXXXXXXXXXXXX";

/**
 * Call: curl 127.0.0.1:3000/ or open url 127.0.0.1:3000/
 * Starts crawling and fetching pages found on Oculus Store main page.
 */
router.get('/', function (req, res, next) {

    function consoleLog(message) {
        const dt = new Date();
        const dtOffset = new Date(dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset()));
        const date = dtOffset.toISOString()

        const splitDate = date
            .replace('T', '@')
            .replace('Z', '')
            .split('@');

        console.log('[' + splitDate[0] + ' ' + splitDate[1] + ']', message)
    }

    async function postExperiencesOnTelegram(storedExperiences) {
        consoleLog("== postExperiencesOnTelegram ==")

        let responseData = null
        let responseError = null

        try {
            const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {polling: false});

            for (let index = 0; index < storedExperiences.length; index++) {
                const storedExperience = storedExperiences[index]

                let text = "DAILY DEAL" + "\n" +
                    "*" + storedExperience['title'] + "*" + "\n" +
                    "Original price: " + storedExperience['originalPrice'] + "\n" +
                    "Discount price: " + storedExperience['salePrice'] + "\n" +
                    "Link: " + storedExperience['link'] + "\n" +
                    "";

                await bot.sendMessage(TELEGRAM_CHANNEL_ID, text
                );
            }

            return [responseData, responseError]
        } catch (e) {
            responseError = res.status(500).send({
                message: 'not ok',
                reason: 'failed post experiences'
            });
            return [responseData, responseError]
        }
    }

    async function closeConsentButton(page) {
        const consentButton = await page.$x("//button[@data-cookiebanner='accept_button']")
        if (consentButton.length > 0) {
            await consentButton[0].click();
        }
    }

    async function getExperiencesLinksForSection(url) {
        consoleLog("== getExperiencesLinksForSection ==")
        consoleLog("section: " + url)

        let responseError = null;
        let responseData = null;

        const browser = await puppeteer.launch({headless: true});
        const page = await browser.newPage();

        try {
            await page.goto(url);
        } catch (e) {
            responseError = res.status(500).send({
                message: 'error',
                reason: 'page not found'
            })
            await browser.close();
            return [null, responseError]
        }

        await closeConsentButton(page);

        await waitFor(WAIT_FOR_DELAY_MS)

        const hrefs = await page.$$eval('a', links => links.map(a => a.href));

        const regex = new RegExp('.*?(\\/experiences\\/quest\\/\\d+)', 'g');
        responseData = hrefs.filter(e => regex.test(e));
        consoleLog("found: " + responseData.length)

        await browser.close();
        return [responseData, null]
    }

    async function getExperiencesSectionLinks(url) {
        consoleLog("== getExperiencesSectionLinks ==")

        let responseError = null;
        let responseData = null;

        const browser = await puppeteer.launch({headless: true});
        const page = await browser.newPage();

        try {
            await page.goto(url);
        } catch (e) {
            responseError = res.status(500).send({
                message: 'error',
                reason: 'page not found'
            })
            await browser.close();
            return [null, responseError]
        }

        await closeConsentButton(page);

        await waitFor(WAIT_FOR_DELAY_MS)

        const hrefs = await page.$$eval('a', links => links.map(a => a.href));

        const regex = new RegExp('.*?(\\/experiences\\/quest\\/section\\/\\d+)', 'g');
        responseData = hrefs.filter(e => regex.test(e));
        consoleLog("found: " + responseData.length)

        await browser.close();
        return [responseData, null]
    }

    async function waitFor(timeToWait) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(true)
            }, timeToWait)
        })
    }

    async function fetchExperiencesLink(url) {
        consoleLog("== fetchExperiencesLink ==")
        consoleLog(url)

        let dailyDealError = {};
        let dailyDeal = {};

        const browser = await puppeteer.launch({headless: true});
        const page = await browser.newPage();

        try {
            await page.goto(url);
        } catch (e) {
            dailyDealError = res.status(500).send({
                message: 'error',
                reason: 'page not found'
            })
            await browser.close();
            return [null, dailyDealError]
        }

        await closeConsentButton(page);

        await waitFor(WAIT_FOR_DELAY_MS)

        dailyDeal['link'] = url

        try {
            await page.waitForSelector(".button__content")
        } catch (e) {
            consoleLog(e.message)
            return [null, null]
        }

        const appDescriptionTitle = await page.$x("//*[@class='app-description__title']")
        const appDescriptionTitleAlt = await page.$x("//*[@class='bxHeading bxHeading--level-2']")

        if (appDescriptionTitle.length > 0) {
            dailyDeal['title'] = await appDescriptionTitle[0].evaluate(el => el.textContent)
        } else if (appDescriptionTitleAlt.length > 0) {
            dailyDeal['title'] = await appDescriptionTitleAlt[0].evaluate(el => el.textContent)
        } else {
            consoleLog("title: unknown")
            await browser.close();
            return [null, null]
        }
        consoleLog("title: " + dailyDeal['title'])

        const appPurchasePrice = await page.$x("//*[@class='app-purchase-price']")
        if (appPurchasePrice.length > 0) {
            dailyDeal['salePrice'] = await appPurchasePrice[0].evaluate(el => el.textContent)

            if (dailyDeal['salePrice'] === 'Get') {
                dailyDeal['salePrice'] = 'Free'
            }
        } else {
            consoleLog("salePrice: unknown")
            await browser.close();
            return [null, null]
        }
        consoleLog("salePrice: " + dailyDeal['salePrice'])

        const appPurchasePriceDiscountDetail =
            await page.$x("//*[@class='app-purchase-price-discount-detail__strikethrough-price']")

        if (appPurchasePriceDiscountDetail.length > 0) {
            dailyDeal['originalPrice'] = await appPurchasePriceDiscountDetail[0].evaluate(el => el.textContent)
        } else if (dailyDeal['salePrice'] === 'Free') {
            dailyDeal['originalPrice'] = 'Free'
        } else {
            consoleLog("originalPrice: unknown")
            await browser.close();
            return [null, null]
        }
        consoleLog("originalPrice: " + dailyDeal['originalPrice'])

        await browser.close();
        return [dailyDeal, null]
    }

    async function createDatabaseIfNotExists() {
        consoleLog("== createDatabaseIfNotExists ==")

        const db = new sqlite3.Database('database.db');

        const QUERY_CREATE_TABLE = "CREATE TABLE IF NOT EXISTS daily_deal " +
            "(" +
            " id INTEGER PRIMARY KEY AUTOINCREMENT," +
            " title TEXT," +
            " originalPrice TEXT," +
            " salePrice TEXT," +
            " link TEXT," +
            " backgroundImageUrl TEXT," +
            " date DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now', 'localtime'))" +
            ")";

        await new Promise((res, rej) => {
            db.run(QUERY_CREATE_TABLE, [], function (err) {
                if (err) {
                    rej(err)
                } else {
                    res(this)
                }
            });
        });

        db.close()
    }

    async function insertExperiencesToDatabase(db, dailyDeal) {
        consoleLog("== insertExperiencesToDatabase ==")

        const q = "INSERT INTO daily_deal (title,originalPrice,salePrice,link,backgroundImageUrl) VALUES (?,?,?,?,?)";

        const params = [
            dailyDeal['title'],
            dailyDeal['originalPrice'],
            dailyDeal['salePrice'],
            dailyDeal['link'],
            dailyDeal['backgroundImageUrl']
        ];

        consoleLog("inserted: " + dailyDeal['title'])

        return await new Promise((res, rej) => {
            db.run(q, params, function (err) {
                if (err) {
                    rej(err.message)
                } else {
                    res(this.lastID)
                }
            })
        });
    }

    async function checkIfExperiencesExistsInDatabase(db, experiences) {
        consoleLog("== checkIfExperiencesExistsInDatabase ==")

        let q = "SELECT * FROM daily_deal WHERE title = ? LIMIT 1";
        let stmt = db.prepare(q)

        let x = await new Promise((res, rej) => {
            stmt.all(experiences['title'], (err, rows) => {
                if (err) {
                    rej(err)
                } else {
                    let found = rows.length !== 0;

                    if (found) {
                        consoleLog("record: " + "'" + experiences['title'] + "'" + " already exists")
                    } else {
                        consoleLog("new record: " + "'" + experiences['title'] + "'" + " !!!")
                    }

                    res(found)
                }
            })
        });

        stmt.finalize()

        return x
    }

    async function insertExperiencesToDatabaseIfNotExists(experiencesDataItems) {
        consoleLog("== insertExperiencesToDatabaseIfNotExists ==")
        consoleLog("discount candidates: " + experiencesDataItems.length)

        const db = new sqlite3.Database('database.db');

        const insertedExperiences = []

        for (let index = 0; index < experiencesDataItems.length; index++) {
            const experiencesDataItem = experiencesDataItems[index];
            const experiencesExists = await checkIfExperiencesExistsInDatabase(db, experiencesDataItem)

            if (experiencesExists === false) {
                let insertedId = await insertExperiencesToDatabase(db, experiencesDataItem);

                if (insertedId !== -1) {
                    insertedExperiences.push(experiencesDataItem)
                }
            }
        }

        db.close()

        consoleLog("inserted: " + insertedExperiences.length)
        return insertedExperiences
    }

    async function fetchExperiencesLinks(experiencesLinks) {
        consoleLog("== fetchExperiencesLinks ==")
        const experiencesDataItems = []

        for (let index = 0; index < experiencesLinks.length; index++) {
            const [experiencesData, dailyDealError] = await fetchExperiencesLink(experiencesLinks[index])

            if (dailyDealError !== null) {
                return [null, dailyDealError]
            }

            if (experiencesData !== null) {
                experiencesDataItems.push(experiencesData)
            }
        }

        return [experiencesDataItems, null]
    }

    function appendArray(arr1, arr2) {
        let l1 = arr1.length;
        let l2 = arr2.length;

        for (let i = 0; i < l2; i++) {
            arr1[l1 + i] = arr2[i];
        }

        return arr1;
    }

    (async () => {
        const [experiencesSectionLinks, experiencesSectionError] =
            await getExperiencesSectionLinks("https://www.oculus.com/experiences/quest/")

        if (experiencesSectionError !== null) {
            return experiencesSectionError
        }

        const finalExperiencesSectionLinks = appendArray(
            ["https://www.oculus.com/experiences/quest/"],
            experiencesSectionLinks
        )

        for (let index = 0; index < finalExperiencesSectionLinks.length; index++) {
            const [experiencesLinks, experiencesError] = await getExperiencesLinksForSection(finalExperiencesSectionLinks[index])

            if (experiencesError !== null) {
                return experiencesError
            }

            const [experiencesDataItems, experiencesDataError] = await fetchExperiencesLinks(experiencesLinks)

            if (experiencesDataError !== null) {
                return experiencesDataError
            }

            await createDatabaseIfNotExists();

            const storedExperiences = await insertExperiencesToDatabaseIfNotExists(experiencesDataItems)

            if (storedExperiences.length > 0) {
                const [experiencesTelegram, experiencesTelegramError] = await postExperiencesOnTelegram(storedExperiences)

                if (experiencesTelegramError !== null) {
                    return experiencesTelegramError
                }
            }
        }

        return res.status(200).send({
            message: 'ok',
            reason: 'done'
        });

    })();
});

module.exports = router;