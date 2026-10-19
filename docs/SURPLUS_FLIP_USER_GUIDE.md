# SWISH Surplus Flip — Step-by-step user guide

This guide follows the Surplus Flip screens supplied on 19 October 2026. It covers importing a supplier XLSX/CSV manifest, reviewing products, adding stock, and preparing eBay drafts. Importing creates drafts only; it does **not** publish listings automatically.

## 1. Open Surplus Flip

1. Open SWISH and choose **Surplus** from the bottom navigation.
2. Tap **Import Job-lot Manifest**.
3. The screen should say **Import a job-lot manifest** and offer **Choose manifest XLSX or CSV**.

## 2. Select the supplier manifest

1. Tap **Choose manifest XLSX or CSV**.
2. In the iPhone file picker, choose the supplier file, for example `MF-1-c2S32Yd.xlsx`.
3. Wait for the **Manifest ready** message.
4. Check the number of product rows reported. In the screenshots, the file loaded **9 product rows**.
5. Tap **OK** to review them.

**Supported input:** XLSX and CSV. The first worksheet is read for XLSX files. A header row and a product title/name/description column are required.

## 3. Review the imported manifest rows

Each product card can show the product title, manifest row/SKU, matched photo, units/pieces, unit cost, target listing price, and condition.

For every row you intend to import:

1. Confirm the product title and photo are the same item.
2. Check **Units / pieces**. This is the total quantity available for that manifest line, not the number of separate eBay listings.
3. Check **Unit cost (£)**. Enter the per-unit acquisition cost if the manifest does not provide it. A displayed £0 means no cost was mapped; it does not mean the goods were free.
4. Enter **Target listing price (£)** if you already know your intended selling price. **Do not use Unit RRP automatically as your selling price**; RRP is a retail reference, not a sale-price instruction.
5. Check the condition. Manifest stock defaults to a customer-return/inspect-before-listing workflow; physically inspect the item and its accessories before making condition claims.
6. Deselect any row you do not want to import. Only selected rows are processed.

## 4. Match a product photo

1. Use the supplier photo if it clearly matches the exact product.
2. If there is no suitable supplier photo, tap **Replace photo**.
3. Choose **Take photo** or **Photo library** and select a clear image of the actual item.
4. Avoid using a photo of a similar but different model or bundle.

The importer now copies the selected supplier/CDN image into SWISH's existing item-image storage instead of treating an expiring supplier URL as permanent. The imported item uses the stored image URL.

## 5. Add selected products to stock

1. Confirm the selected-row count on **Add selected products to stock**.
2. Tap the button once and wait for the progress indicator to finish.
3. Do not leave the screen while the import is running.
4. Read the completion message. It reports how many product rows were added and any rows that failed.
5. If a row says it was already imported, the importer has skipped that same manifest row to reduce duplicate stock.

A row with **5 units** creates one stock record with quantity 5. Check the stock card after import to confirm the quantity is still correct.

## 6. Open the created eBay draft

1. Go to **Stock** and open the imported product.
2. Open its eBay listing/draft using the existing SWISH listing workflow.
3. Review the generated title and description. Remove any statement that has not been verified by inspecting the physical item.
4. Confirm the eBay category. The screenshots show **Pond & Fountain Pumps (ID 139921)** as a verified leaf category for the solar fountain product.
5. Select the correct condition and add accurate condition notes.
6. Confirm the photos show the actual product.
7. Review item specifics. Supplier tracking fields such as Manifest Row, Supplier SKU, Unit RRP, Niche Id and Source Type are internal stock metadata and should not be buyer-facing item specifics. The targeted fix excludes these internal fields from the generated specifics.
8. Confirm **Simple Delivery** and the selected fulfilment/return policies remain in place.

## 7. Set and verify the selling price

The preflight screen blocks submission when the listing price is £0.00 or blank. This is intentional: SWISH must not invent a sale price from the supplier's RRP or silently publish a free listing.

1. In the listing editor, tap **Set price** or edit the listing price.
2. Enter the intended selling price in GBP.
3. Save the draft.
4. Return to **Listing Preflight** and let it run again.
5. Confirm the **Price** check is green and shows the expected amount.

If you have not decided the price yet, leave the item as a draft and do not submit it.

## 8. Run market valuation if useful

The screenshots show the error **[403] Item and valuation specialist belong to different products**. The valuation function did not recognise the Surplus Flip specialist, so it rejected a valid surplus item. The targeted fix maps `surplus_trader` and `surplus_flip` to the same Surplus Flip product boundary. After the updated Edge Function is deployed, reopen the item and tap **Re-Value** again.

Treat valuation as research, not an automatic price decision. Check the evidence and condition match before choosing a selling price.

## 9. Complete preflight and submit deliberately

Before submitting, check that:

- The title is meaningful and no more than 80 characters.
- The price is greater than £0.00.
- The category is a valid current eBay leaf category.
- The condition is set correctly.
- At least one permanent HTTPS product image is available.
- Required item specifics are present.
- Fulfilment and return policies are selected, with **Simple Delivery** retained.

Fix any red check, then run preflight again. Submit only when the checks pass and you are happy with the listing. Importing itself never publishes automatically.

## Troubleshooting

**“No product rows found”**
- Confirm the file has a header row and product title/name/description column.
- Use the original XLSX or export it as CSV; do not select a ZIP or HTML file.

**Price check is red**
- Set a real listing price in the listing editor and save. Unit RRP is not automatically substituted.

**Photos warning**
- Reopen the item after the image-storage fix is deployed and ensure a stored image is present. A supplier/eBay CDN URL alone may expire.

**Market valuation returns 403**
- Confirm the updated `swish-market-value` Edge Function has been deployed. Retry Re-Value after deployment.

**Quantity looks wrong**
- Compare the manifest Units / pieces value with the stock record quantity before submitting. For multi-unit stock, confirm the eBay listing's quantity on the final review screen; auctions are single-quantity by design.

**A draft was created but an import warning appeared**
- Open the stock record and confirm whether the draft exists before retrying. Do not import the same manifest row repeatedly, as that can create duplicates if the first attempt partially succeeded.

## Scope and safety

This workflow uses the existing SWISH database, inventory service, and eBay listing architecture. It does not create a new database, change the screen layout, or publish automatically. Inspect customer-return stock and confirm price, quantity, condition, photo, category and delivery before listing.
