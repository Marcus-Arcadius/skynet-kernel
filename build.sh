#!/bin/bash

# This is a script which builds and deploys the kernel. The general process is
# that we copy every file to a build directory, then we compute a v2skylink for
# each file, then we compile every file by replacing the 'branch-file'
# directives with the correct v2skylinks, finally we upload the compiled files
# to skynet and update the corresponding v2 skylinks.
#
# The result is that the files can be uploaded in any order, and the
# 'branch-file' primitives allows for circular communication.

# Detect that skynet-utils is available.
if ! [ -x "$(command -v skynet-utils)" ]; then
	echo "skynet-utils could not be found, please install skynet-utils"
	exit
fi
if ! [ -x "$(command -v tsc)" ]; then
	echo "tsc (typescript compiler) could not be found, please install typescript"
	exit
fi

# Check the build-cache for a seed. If none exists, create one and save it to
# the build-cache.
mkdir -p build-cache
if [ -f build-cache/seed ];
then
	seed=$(cat build-cache/seed)
else
	seed=$(skynet-utils generate-seed)
	echo $seed > build-cache/seed
fi

# Copy the source folder so we can perform preprocessing.
mkdir -p extension/bundle
cp extension/src/* extension/bundle/

# Iterate through the bundle files, looking for import statements.
srcs=$(find extension/bundle)
for src in $srcs
do
	# Skip any directories.
	if [ -d $src ]
	then
		continue
	fi
	# Skip any swp files.
	if [ -z ${src##*.swp} ]
	then
		continue
	fi

	# Find all of the import statements in this file, and for each
	# statement execute the import.
	imports=$(grep "// import:::" $src)
	grep "// import:::" $src | while read line
	do
		# Trim the import to just the filename.
		importFile=$(echo $line | cut -c 13-)

		# Get the import line, and related variables that will allow us
		# to inject the code.
		importLine=$(grep -n "$line" $src | cut -f1 -d:)
		upTo=$((importLine-1))
		after=$((importLine+1))

		# Get the composed data for each file.
		prefix=$(sed -n 1,${upTo}p $src)
		lib=$(cat $importFile)
		suffix=$(sed -n ${after},'$p' $src)

		bundleFile="${src/src/"bundle"}"
		rm $bundleFile
		cat <<< $prefix >> $bundleFile
		cat <<< $lib >> $bundleFile
		cat <<< $suffix >> $bundleFile
	done
done

# Inject the default user kernel into the content-kernel.ts bundled file.
#
# TODO: Eventually we will be able to scrap this code. The default user kernel
# should be hardcoded, but while we're rapidly iterating on the first version
# of the kernel it made more sense to load it in dynamically. We will remove
# this code around the same time that we pull the full kernel into its own git
# repo.
kernelV2skylink=$(skynet-utils generate-v2skylink kernel/skynet-kernel.js $seed)
fileD="kernel/kernel.js"
fileO="extension/bundle/content-kernel.ts"
importLine=$(grep -n "// transplant:::$fileD" $fileO | cut -f1 -d:)
upTo=$((importLine-1))
after=$((importLine+1))
authFilePrefix=$(sed -n 1,${upTo}p extension/bundle/content-kernel.ts)
transplantCode="var defaultKernelResolverLink = \"$kernelV2skylink\";"
authFileSuffix=$(sed -n ${after},'$p' extension/bundle/content-kernel.ts)
rm $fileO
cat <<< $authFilePrefix >> $fileO
cat <<< $transplantCode >> $fileO
cat <<< $authFileSuffix >> $fileO

# Recreate the build directory and copy the source files over.
rm -rf build
mkdir -p build/extension
mkdir -p build/kernel
cp -r extension/assets/* build/extension

# Perform the typescript compilations.
( cd extension && tsc ) || exit 1
( cd kernel && tsc ) || exit 1

# Strip the typescript declaration from all of the files in the browser
# extension, as this breaks compatibility with the extensions system. The
# declaration always appears at the second line of the file.
files=$(find build/extension/*.js)
for file in $files
do
	sed -i '2d' $file
done

# Create a v2 skylink for each file in each directory, and perform a
# find-and-replace on the rest of the files in the directory to replace
# relative path references with the appropriate v2 skylink.
files=$(find build)
for file in $files
do
	# Skip any directories.
	if [ -d $file ];
	then
		continue
	fi
	# Skip any swp files.
	if [ -z ${file##*.swp} ];
	then
		continue
	fi

	# Generate the v2 skylink for this file.
	v2skylink=$(skynet-utils generate-v2skylink ${file#*/} $seed)
	# Escape the filename for compatibility.
	escaped_file=$(printf '%s\n' "${file#*/}" | sed -e 's/[]\/$*.^[]/\\&/g')
	# Update every other file in the directory to use the v2 skylink.
	grep -lr "branch-file:::${file#*/}" build | xargs -r sed -i -e "s/branch-file:::$escaped_file/$v2skylink/g"
done

# Now that every file has been updated to reference the correct v2 skylinks,
# upload them all to skynet and update the corresponding v2 skylinks to point
# to the correct file. After this is done, the kernel should be functional.
for file in $files
do
	# Skip any directories.
	if [ -d $file ]
	then
		continue
	fi
	# Skip any swp files.
	if [ -z ${file##*.swp} ]
	then
		continue
	fi
	if [[ "$file" == *"extension"* ]]
	then
		continue
	fi

	# Get the v1skylink and determine whether the skylink has changed from
	# the previous run. If it has not, skip this upload as the v2skylink
	# should already be pointing to the right place.
	v1skylink=$(skynet-utils upload-file-dry $file)
	oldv1=$(cat build-cache/${file#*/} 2> /dev/null)
	if [ "$v1skylink" == "$oldv1" ];
	then
		continue
	fi
	uploadedFile="true"

	# Upload the file and update the v2skylink.
	echo "Uploading ${file#*/}: $v1skylink"
	v1skylinkup=$(skynet-utils upload-file $file)
	if [ "$v1skylink" != "$v1skylinkup" ];
	then
		echo "dry and v1 mismatch"
		echo $v1skylinkup
		exit 1
	fi
	skynet-utils upload-to-v2skylink $v1skylink ${file#*/} $seed || exit 1

	# Save the link in build-cache
	mkdir -p $(dirname "build-cache/${file#*/}")
	echo $v1skylink > build-cache/${file#*/}
done

# Only instruct the user to refersh their browser extension if something
# changed.
if [ "$uploadedFile" == "true" ];
then
	# If something changed, there will be prior output and we want an extra
	# newline.
	echo
	echo refresh the extension in your browser and then test with the test file
fi
