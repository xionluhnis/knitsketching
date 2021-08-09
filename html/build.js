"use strict";

const gulp = require('gulp');
const include = require('gulp-html-tag-include');

// basic html bundle
gulp.task('build', function() {
	return gulp.src('./index.html')
		.pipe(include())
		.pipe(gulp.dest('..'));
});

// watch html
gulp.task('watch', function(cb /* important to keep! */) {
	gulp.watch('./**/*.html', gulp.series('build'));
});

gulp.task('default', gulp.series('build', 'watch'));