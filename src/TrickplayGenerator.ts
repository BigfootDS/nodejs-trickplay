import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpeg from 'fluent-ffmpeg';
import path from 'node:path';
import fs from "node:fs";
import { Jimp } from 'jimp';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export type TrickplayGeneratorOptions = {
	trickplayOutputDir?: string;
	secondsBetweenFrames?: number;
	numberOfFramesToGrab?: number;
	frameTimestamps?: string[];
	trickplayImageWidth?: number;
	trickplaySheetRows?: number;
	trickplaySheetColumns?: number;
	skipIndividualFrameGeneration?: boolean;
	individualFrameFileFormat?: string;
	tilesheetFileFormat?: string;
}



export async function generateTrickplay(targetVideoPath: string, options: TrickplayGeneratorOptions = {}){

	//#region Function prep

	console.log("Performing trickplay on: " + targetVideoPath);

	// Make sure target video exists
	if (!fs.existsSync(targetVideoPath)){
		console.log("Path does not lead to a file: " + targetVideoPath);
	}

	// Analyse video for metadata such as its duration.
	// We need things like duration to figure out how many images to make.
	let videoMetadata: ffmpeg.FfprobeData | null = null;
	videoMetadata = await new Promise((resolve, reject) => {
		ffmpeg(targetVideoPath).ffprobe((error: Error, metadata) => {
			if (error) {
				reject(error);
			}

			videoMetadata = metadata;
			resolve(videoMetadata);
		});
	});

	// If the video was invalid or no important metadata could be found, cancel.
	if (videoMetadata == null || videoMetadata.format.duration == undefined) return;

	console.log(videoMetadata.format.duration);

	let targetVideoFilename = path.basename(targetVideoPath);
	console.log(targetVideoFilename);

	//#endregion

	//#region Prepare the generator options
	let localOptions = {
		trickplayOutputDir: options.trickplayOutputDir || targetVideoPath.slice(0, targetVideoPath.indexOf(targetVideoFilename)) + targetVideoFilename.slice(0, targetVideoFilename.lastIndexOf(".")) + ".trickplay",
		secondsBetweenFrames: options.secondsBetweenFrames || 10,
		numberOfFramesToGrab: Math.floor(videoMetadata.format.duration / (options.secondsBetweenFrames || 10)),
		frameTimestamps: options.frameTimestamps || [],
		trickplayImageWidth: options.trickplayImageWidth || 320,
		trickplaySheetRows: options.trickplaySheetRows || 10,
		trickplaySheetColumns: options.trickplaySheetColumns || 10,
		skipIndividualFrameGeneration: options.skipIndividualFrameGeneration || false,
		individualFrameFileFormat: options.individualFrameFileFormat || "jpg",
		tilesheetFileFormat: options.tilesheetFileFormat || "jpg"
	};
	

	localOptions.frameTimestamps = new Array(Math.floor(localOptions.numberOfFramesToGrab)).fill(0).map((_, index) => {
		return (index * localOptions.secondsBetweenFrames).toString();
	});

	console.log(JSON.stringify(localOptions, null, 4));

	//#endregion

	//#region Generate the trickplay images
	if (!localOptions.skipIndividualFrameGeneration){

		// Make sure raw frames directory exists
		let rawFramesDirectory = path.resolve(localOptions.trickplayOutputDir,"frames");
		if (!fs.existsSync(rawFramesDirectory)){
			console.log("Making raw frames directory at:\n" + rawFramesDirectory);
			fs.mkdirSync(rawFramesDirectory, {recursive: true});
		}

		let createdTrickplayImagePaths: string[] = [];
		let screenshotOptions = {
			count: localOptions.frameTimestamps!.length,
			timemarks: localOptions.frameTimestamps,
			size: localOptions.trickplayImageWidth +"x?",
			filename: "%i." + localOptions.individualFrameFileFormat
		};
		console.log("---");
		console.log(JSON.stringify(screenshotOptions, null, 4));
		console.log("---");
		let resultViaMethods = await new Promise((resolve, reject) => {
			ffmpeg(targetVideoPath).takeScreenshots(
				screenshotOptions,
				localOptions.trickplayOutputDir + "/frames"
			).on("filenames", (filenames) => {
				createdTrickplayImagePaths = [...filenames];
			}).on("end", () => {
				resolve(true);
			}).on("error", () => {
				reject(false);
			});
		});
		if(resultViaMethods){
			console.log("Image generation successful: " + resultViaMethods);
			console.log(createdTrickplayImagePaths);
		} else {
			return;
		}
	}
	
	//#endregion

	//#region Composite (a.k.a stitch) the raw trickplay images together into a trickplay tilesheet.

	// Prepare a tilesheet output directory
	let tilesheetDirectory = path.resolve(localOptions.trickplayOutputDir, `${localOptions.trickplayImageWidth} - ${localOptions.trickplaySheetColumns}x${localOptions.trickplaySheetRows}`);
	console.log("Preparing to put the trickplay tilesheet into:\n" + tilesheetDirectory);
	if (!fs.existsSync(tilesheetDirectory)){
		fs.mkdirSync(tilesheetDirectory);
	}


	let individualFramePaths: string[] = [];
	let rawFramesDirectory = path.resolve(localOptions.trickplayOutputDir,"frames");
	console.log("Raw frames should be expected at: \n" + rawFramesDirectory);

	fs.readdirSync(rawFramesDirectory, {withFileTypes: true}).forEach((foundFile) => {
		if (foundFile.isFile()){
			let foundFileExtension = foundFile.name.slice(foundFile.name.lastIndexOf(".") + 1);
			if (foundFileExtension.toLocaleLowerCase() == localOptions.individualFrameFileFormat.toLocaleLowerCase()){
				individualFramePaths.push(foundFile.name)
			}
		}
	});

	individualFramePaths.sort((a, b) => {
		let aNoExt = Number.parseInt(a.slice(0, a.lastIndexOf(".")));
		let bNoExt = Number.parseInt(b.slice(0, b.lastIndexOf(".")));

		return aNoExt - bNoExt;
	})

	console.log(individualFramePaths);

	let framePaths2dGrid = [];
	while(individualFramePaths.length) {
		framePaths2dGrid.push(individualFramePaths.splice(0, 10));
	}
	console.log(framePaths2dGrid.length);
	let tilesheetCount = Math.ceil(framePaths2dGrid.length / localOptions.trickplaySheetRows);
	console.log(tilesheetCount);

	let sampleFrame = await Jimp.read(path.resolve(rawFramesDirectory, framePaths2dGrid[0][0]));

	let tilesheets = [];

	for (let index = 0; index < tilesheetCount; index++) {
		tilesheets.push(new Jimp({
			width: localOptions.trickplayImageWidth * localOptions.trickplaySheetColumns,
			height: sampleFrame.height * localOptions.trickplaySheetRows,
			color: "0xffffffff"
		}));
	}

	console.log(`Tilesheet dimensions:\nwidth:${tilesheets[0].width}\nheight:${tilesheets[0].height}`);

	let imageOperations: Promise<boolean>[] = [];
	
	framePaths2dGrid.forEach(async (row, rowIndex) => {

		let targetTilesheetIndex = Math.floor(rowIndex / localOptions.trickplaySheetRows);
		console.log(targetTilesheetIndex);

		row.forEach(async (item, itemIndex) => {
			imageOperations.push(new Promise(async (resolve, reject) => {
				let targetItemPath = path.resolve(rawFramesDirectory,item);
				console.log(targetItemPath);
				let foundImage = await Jimp.read(targetItemPath);
				let xPosition = itemIndex * localOptions.trickplayImageWidth;
				let yPosition = (rowIndex - (targetTilesheetIndex * 10)) * sampleFrame.height;

				console.log(`Would place image ${item} at tilesheet position x: ${xPosition}, y: ${yPosition}, row ${rowIndex}, tilesheet ${targetTilesheetIndex}`);

				await tilesheets[targetTilesheetIndex].composite(foundImage, xPosition, yPosition);
				resolve(true);
			}))
		})
	});

	await Promise.all(imageOperations);


	tilesheets.forEach(async (tilesheet, index) => {
		await tilesheet.write(`${tilesheetDirectory}/${index}.${localOptions.tilesheetFileFormat}`);
	})

	//#endregion

}