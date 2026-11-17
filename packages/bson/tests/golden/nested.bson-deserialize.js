// externals: skipValue_0, readDouble_0, nanToZero_0, readNumberValue_0, skipCString_0
'use strict';
return function(buffer,offset){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var kind_5="circle";
var r_6=0;
while(o_4<end_3){
    var type_7=buffer[o_4];
    o_4+=1;
    if(type_7===0){
        break;
    }
    if(buffer[o_4]===107&&buffer[(o_4+1)]===105&&buffer[(o_4+2)]===110&&buffer[(o_4+3)]===100&&buffer[(o_4+4)]===0){
        o_4+=5;
        kind_5="circle";
        o_4=skipValue_0(buffer,o_4,type_7);
    }else{
        if(buffer[o_4]===114&&buffer[(o_4+1)]===0){
            o_4+=2;
            if(type_7===16){
                r_6=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
                o_4+=4;
            }else{
                if(type_7===1){
                    var dblVal_8=readDouble_0(buffer,o_4);
                    r_6=nanToZero_0(dblVal_8);
                    o_4+=8;
                }else{
                    var numFallback_9=readNumberValue_0(buffer,o_4,type_7);
                    r_6=numFallback_9[0];
                    o_4+=numFallback_9[1];
                }
            }
        }else{
            o_4=skipCString_0(buffer,o_4);
            o_4=skipValue_0(buffer,o_4,type_7);
        }
    }
}
var result_10={};
result_10.kind=kind_5;
result_10.r=r_6;
return [result_10,(end_3+1)];
}

// externals: skipValue_0, const_0, readDouble_0, nanToZero_0, readNumberValue_0, fn_0
'use strict';
function _nfn_0(buffer,o,ft){
var ho_3=o;
var val_4="circle";
val_4="circle";
ho_3=skipValue_0(buffer,ho_3,ft);
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_1(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===107&&buffer[(o+2)]===105&&buffer[(o+3)]===110&&buffer[(o+4)]===100&&buffer[(o+5)]===0){
        var do_4=(o+6);
        _nfn_0(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]="circle";
const_0[1]=o;
}
function _nfn_2(buffer,o,ft){
var ho_3=o;
var val_4=0;
if(ft===16){
    val_4=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
    ho_3+=4;
}else{
    if(ft===1){
        var dblVal_5=readDouble_0(buffer,ho_3);
        val_4=nanToZero_0(dblVal_5);
        ho_3+=8;
    }else{
        var numFallback_6=readNumberValue_0(buffer,ho_3,ft);
        val_4=numFallback_6[0];
        ho_3+=numFallback_6[1];
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_3(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===114&&buffer[(o+2)]===0){
        var do_4=(o+3);
        if(ft_3===16){
            const_0[0]=((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)));
            const_0[1]=(do_4+4);
            return;
        }
        _nfn_2(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=0;
const_0[1]=o;
}
return function(buffer,offset){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var kind_5="circle";
var r_6=0;
_nfn_1(buffer,o_4,end_3);
kind_5=const_0[0];
o_4=const_0[1];
_nfn_3(buffer,o_4,end_3);
r_6=const_0[0];
o_4=const_0[1];
if(buffer[o_4]!==0){
    return fn_0(buffer,offset);
}
var result_7={};
result_7.kind=kind_5;
result_7.r=r_6;
return [result_7,(end_3+1)];
}

// externals: skipValue_0, readDouble_0, nanToZero_0, readNumberValue_0, skipCString_0
'use strict';
return function(buffer,offset){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var kind_5="rect";
var w_6=0;
var h_7=0;
while(o_4<end_3){
    var type_8=buffer[o_4];
    o_4+=1;
    if(type_8===0){
        break;
    }
    if(buffer[o_4]===107&&buffer[(o_4+1)]===105&&buffer[(o_4+2)]===110&&buffer[(o_4+3)]===100&&buffer[(o_4+4)]===0){
        o_4+=5;
        kind_5="rect";
        o_4=skipValue_0(buffer,o_4,type_8);
    }else{
        if(buffer[o_4]===119&&buffer[(o_4+1)]===0){
            o_4+=2;
            if(type_8===16){
                w_6=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
                o_4+=4;
            }else{
                if(type_8===1){
                    var dblVal_11=readDouble_0(buffer,o_4);
                    w_6=nanToZero_0(dblVal_11);
                    o_4+=8;
                }else{
                    var numFallback_12=readNumberValue_0(buffer,o_4,type_8);
                    w_6=numFallback_12[0];
                    o_4+=numFallback_12[1];
                }
            }
        }else{
            if(buffer[o_4]===104&&buffer[(o_4+1)]===0){
                o_4+=2;
                if(type_8===16){
                    h_7=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
                    o_4+=4;
                }else{
                    if(type_8===1){
                        var dblVal_9=readDouble_0(buffer,o_4);
                        h_7=nanToZero_0(dblVal_9);
                        o_4+=8;
                    }else{
                        var numFallback_10=readNumberValue_0(buffer,o_4,type_8);
                        h_7=numFallback_10[0];
                        o_4+=numFallback_10[1];
                    }
                }
            }else{
                o_4=skipCString_0(buffer,o_4);
                o_4=skipValue_0(buffer,o_4,type_8);
            }
        }
    }
}
var result_13={};
result_13.kind=kind_5;
result_13.w=w_6;
result_13.h=h_7;
return [result_13,(end_3+1)];
}

// externals: skipValue_0, const_0, readDouble_0, nanToZero_0, readNumberValue_0, fn_0
'use strict';
function _nfn_4(buffer,o,ft){
var ho_3=o;
var val_4="rect";
val_4="rect";
ho_3=skipValue_0(buffer,ho_3,ft);
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_5(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===107&&buffer[(o+2)]===105&&buffer[(o+3)]===110&&buffer[(o+4)]===100&&buffer[(o+5)]===0){
        var do_4=(o+6);
        _nfn_4(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]="rect";
const_0[1]=o;
}
function _nfn_6(buffer,o,ft){
var ho_3=o;
var val_4=0;
if(ft===16){
    val_4=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
    ho_3+=4;
}else{
    if(ft===1){
        var dblVal_5=readDouble_0(buffer,ho_3);
        val_4=nanToZero_0(dblVal_5);
        ho_3+=8;
    }else{
        var numFallback_6=readNumberValue_0(buffer,ho_3,ft);
        val_4=numFallback_6[0];
        ho_3+=numFallback_6[1];
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_7(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===119&&buffer[(o+2)]===0){
        var do_4=(o+3);
        if(ft_3===16){
            const_0[0]=((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)));
            const_0[1]=(do_4+4);
            return;
        }
        _nfn_6(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=0;
const_0[1]=o;
}
function _nfn_8(buffer,o,ft){
var ho_3=o;
var val_4=0;
if(ft===16){
    val_4=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
    ho_3+=4;
}else{
    if(ft===1){
        var dblVal_5=readDouble_0(buffer,ho_3);
        val_4=nanToZero_0(dblVal_5);
        ho_3+=8;
    }else{
        var numFallback_6=readNumberValue_0(buffer,ho_3,ft);
        val_4=numFallback_6[0];
        ho_3+=numFallback_6[1];
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_9(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===104&&buffer[(o+2)]===0){
        var do_4=(o+3);
        if(ft_3===16){
            const_0[0]=((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)));
            const_0[1]=(do_4+4);
            return;
        }
        _nfn_8(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=0;
const_0[1]=o;
}
return function(buffer,offset){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var kind_5="rect";
var w_6=0;
var h_7=0;
_nfn_5(buffer,o_4,end_3);
kind_5=const_0[0];
o_4=const_0[1];
_nfn_7(buffer,o_4,end_3);
w_6=const_0[0];
o_4=const_0[1];
_nfn_9(buffer,o_4,end_3);
h_7=const_0[0];
o_4=const_0[1];
if(buffer[o_4]!==0){
    return fn_0(buffer,offset);
}
var result_8={};
result_8.kind=kind_5;
result_8.w=w_6;
result_8.h=h_7;
return [result_8,(end_3+1)];
}

// externals: const_0, readDouble_0, nanToZero_0, readNumberValue_0, readInt32LE_0, skipCString_0, readBSONStringDirect_0, readStringValue_0, skipValue_0, makeBsonConversionError_0, create_0, readCStringHelper_0, makeUnionNoMatchError_0, fn_0, makeUndefinedConversionError_0
'use strict';
return function(buffer,offset){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var id_5=0;
var tags_6=const_0;
var meta_7=const_0;
var state_8=const_0;
var shape_9=const_0;
var owner_10=const_0;
while(o_4<end_3){
    var type_11=buffer[o_4];
    o_4+=1;
    if(type_11===0){
        break;
    }
    if(buffer[o_4]===105&&buffer[(o_4+1)]===100&&buffer[(o_4+2)]===0){
        o_4+=3;
        if(type_11===16){
            id_5=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
            o_4+=4;
        }else{
            if(type_11===1){
                var dblVal_63=readDouble_0(buffer,o_4);
                id_5=nanToZero_0(dblVal_63);
                o_4+=8;
            }else{
                var numFallback_64=readNumberValue_0(buffer,o_4,type_11);
                id_5=numFallback_64[0];
                o_4+=numFallback_64[1];
            }
        }
    }else{
        if(buffer[o_4]===116&&buffer[(o_4+1)]===97&&buffer[(o_4+2)]===103&&buffer[(o_4+3)]===115&&buffer[(o_4+4)]===0){
            o_4+=5;
            if(type_11===4){
                var arr_46=[];
                var arrSize_47=readInt32LE_0(buffer,o_4);
                var arrEnd_48=(o_4+(arrSize_47-1));
                o_4+=4;
                while(o_4<arrEnd_48){
                    var elemType_49=buffer[o_4];
                    o_4+=1;
                    if(elemType_49===0){
                        break;
                    }
                    o_4=skipCString_0(buffer,o_4);
                    var elem_50=undefined;
                    if(elemType_49===3){
                        var docSize_51=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
                        var end_52=(o_4+(docSize_51-1));
                        var o_53=(o_4+4);
                        var id_54=0;
                        var label_55="";
                        while(o_53<end_52){
                            var type_56=buffer[o_53];
                            o_53+=1;
                            if(type_56===0){
                                break;
                            }
                            if(buffer[o_53]===105&&buffer[(o_53+1)]===100&&buffer[(o_53+2)]===0){
                                o_53+=3;
                                if(type_56===16){
                                    id_54=((buffer[o_53]|(buffer[(o_53+1)]<<8))|((buffer[(o_53+2)]<<16)|(buffer[(o_53+3)]<<24)));
                                    o_53+=4;
                                }else{
                                    if(type_56===1){
                                        var dblVal_59=readDouble_0(buffer,o_53);
                                        id_54=nanToZero_0(dblVal_59);
                                        o_53+=8;
                                    }else{
                                        var numFallback_60=readNumberValue_0(buffer,o_53,type_56);
                                        id_54=numFallback_60[0];
                                        o_53+=numFallback_60[1];
                                    }
                                }
                            }else{
                                if(buffer[o_53]===108&&buffer[(o_53+1)]===97&&buffer[(o_53+2)]===98&&buffer[(o_53+3)]===101&&buffer[(o_53+4)]===108&&buffer[(o_53+5)]===0){
                                    o_53+=6;
                                    if(type_56===2){
                                        var strLen_57=(((buffer[o_53]|(buffer[(o_53+1)]<<8))|((buffer[(o_53+2)]<<16)|(buffer[(o_53+3)]<<24)))-1);
                                        o_53+=4;
                                        label_55=readBSONStringDirect_0(buffer,o_53,strLen_57);
                                        o_53+=(strLen_57+1);
                                    }else{
                                        var strFallback_58=readStringValue_0(buffer,o_53,type_56);
                                        label_55=strFallback_58[0];
                                        o_53+=strFallback_58[1];
                                    }
                                }else{
                                    o_53=skipCString_0(buffer,o_53);
                                    o_53=skipValue_0(buffer,o_53,type_56);
                                }
                            }
                        }
                        var result_61={};
                        result_61.id=id_54;
                        result_61.label=label_55;
                        var objResult_62=[result_61,(end_52+1)];
                        elem_50=objResult_62[0];
                        o_4=objResult_62[1];
                    }else{
                        if((elemType_49===10||elemType_49===6)){
                            throw makeBsonConversionError_0(elemType_49,"{id: number, label: string}");
                        }else{
                            o_4=skipValue_0(buffer,o_4,elemType_49);
                        }
                    }
                    arr_46.push(elem_50);
                }
                tags_6=arr_46;
                o_4=(arrEnd_48+1);
            }else{
                throw makeBsonConversionError_0(type_11,"Array<{id: number, label: string}>");
            }
        }else{
            if(buffer[o_4]===109&&buffer[(o_4+1)]===101&&buffer[(o_4+2)]===116&&buffer[(o_4+3)]===97&&buffer[(o_4+4)]===0){
                o_4+=5;
                if((type_11===10||type_11===6)){
                    throw makeBsonConversionError_0(type_11,"{}");
                }else{
                    if(type_11===3){
                        var docSize_31=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
                        var end_32=(o_4+(docSize_31-1));
                        var o_33=(o_4+4);
                        var indexObj_34=create_0(null);
                        while(o_33<end_32){
                            var type_35=buffer[o_33];
                            o_33+=1;
                            if(type_35===0){
                                break;
                            }
                            var nameResult_36=readCStringHelper_0(buffer,o_33);
                            o_33+=nameResult_36[1];
                            var indexVal_37=undefined;
                            if(type_35===2){
                                if(type_35===2){
                                    var strLen_42=(((buffer[o_33]|(buffer[(o_33+1)]<<8))|((buffer[(o_33+2)]<<16)|(buffer[(o_33+3)]<<24)))-1);
                                    o_33+=4;
                                    indexVal_37=readBSONStringDirect_0(buffer,o_33,strLen_42);
                                    o_33+=(strLen_42+1);
                                }else{
                                    var strFallback_43=readStringValue_0(buffer,o_33,type_35);
                                    indexVal_37=strFallback_43[0];
                                    o_33+=strFallback_43[1];
                                }
                            }else{
                                if((type_35===16||type_35===1)){
                                    if(type_35===16){
                                        indexVal_37=((buffer[o_33]|(buffer[(o_33+1)]<<8))|((buffer[(o_33+2)]<<16)|(buffer[(o_33+3)]<<24)));
                                        o_33+=4;
                                    }else{
                                        if(type_35===1){
                                            var dblVal_40=readDouble_0(buffer,o_33);
                                            indexVal_37=nanToZero_0(dblVal_40);
                                            o_33+=8;
                                        }else{
                                            var numFallback_41=readNumberValue_0(buffer,o_33,type_35);
                                            indexVal_37=numFallback_41[0];
                                            o_33+=numFallback_41[1];
                                        }
                                    }
                                }else{
                                    if(type_35===8){
                                        if(type_35===16){
                                            indexVal_37=((buffer[o_33]|(buffer[(o_33+1)]<<8))|((buffer[(o_33+2)]<<16)|(buffer[(o_33+3)]<<24)));
                                            o_33+=4;
                                        }else{
                                            if(type_35===1){
                                                var dblVal_38=readDouble_0(buffer,o_33);
                                                indexVal_37=nanToZero_0(dblVal_38);
                                                o_33+=8;
                                            }else{
                                                var numFallback_39=readNumberValue_0(buffer,o_33,type_35);
                                                indexVal_37=numFallback_39[0];
                                                o_33+=numFallback_39[1];
                                            }
                                        }
                                    }else{
                                        throw makeUnionNoMatchError_0(type_35,"string | number");
                                    }
                                }
                            }
                            indexObj_34[nameResult_36[0]]=indexVal_37;
                        }
                        var result_44=indexObj_34;
                        var objResult_45=[result_44,(end_32+1)];
                        meta_7=objResult_45[0];
                        o_4=objResult_45[1];
                    }else{
                        if((type_11===10||type_11===6)){
                            throw makeBsonConversionError_0(type_11,"{}");
                        }else{
                            o_4=skipValue_0(buffer,o_4,type_11);
                        }
                    }
                }
            }else{
                if(buffer[o_4]===115&&buffer[(o_4+1)]===116&&buffer[(o_4+2)]===97&&buffer[(o_4+3)]===116&&buffer[(o_4+4)]===101&&buffer[(o_4+5)]===0){
                    o_4+=6;
                    if(type_11===2){
                        var litStr_30=readStringValue_0(buffer,o_4,type_11);
                        state_8=litStr_30[0];
                        o_4+=litStr_30[1];
                    }else{
                        throw makeUnionNoMatchError_0(type_11,"draft | live | gone");
                    }
                }else{
                    if(buffer[o_4]===115&&buffer[(o_4+1)]===104&&buffer[(o_4+2)]===97&&buffer[(o_4+3)]===112&&buffer[(o_4+4)]===101&&buffer[(o_4+5)]===0){
                        o_4+=6;
                        if(type_11===3){
                            var multiObjResult_29=fn_0(buffer,o_4);
                            shape_9=multiObjResult_29[0];
                            o_4=multiObjResult_29[1];
                        }else{
                            throw makeUnionNoMatchError_0(type_11,"Shape");
                        }
                    }else{
                        if(buffer[o_4]===111&&buffer[(o_4+1)]===119&&buffer[(o_4+2)]===110&&buffer[(o_4+3)]===101&&buffer[(o_4+4)]===114&&buffer[(o_4+5)]===0){
                            o_4+=6;
                            if((type_11===10||type_11===6)){
                                throw makeBsonConversionError_0(type_11,"{id: number, names: array}");
                            }else{
                                if(type_11===3){
                                    var docSize_12=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
                                    var end_13=(o_4+(docSize_12-1));
                                    var o_14=(o_4+4);
                                    var id_15=0;
                                    var names_16=const_0;
                                    while(o_14<end_13){
                                        var type_17=buffer[o_14];
                                        o_14+=1;
                                        if(type_17===0){
                                            break;
                                        }
                                        if(buffer[o_14]===105&&buffer[(o_14+1)]===100&&buffer[(o_14+2)]===0){
                                            o_14+=3;
                                            if(type_17===16){
                                                id_15=((buffer[o_14]|(buffer[(o_14+1)]<<8))|((buffer[(o_14+2)]<<16)|(buffer[(o_14+3)]<<24)));
                                                o_14+=4;
                                            }else{
                                                if(type_17===1){
                                                    var dblVal_25=readDouble_0(buffer,o_14);
                                                    id_15=nanToZero_0(dblVal_25);
                                                    o_14+=8;
                                                }else{
                                                    var numFallback_26=readNumberValue_0(buffer,o_14,type_17);
                                                    id_15=numFallback_26[0];
                                                    o_14+=numFallback_26[1];
                                                }
                                            }
                                        }else{
                                            if(buffer[o_14]===110&&buffer[(o_14+1)]===97&&buffer[(o_14+2)]===109&&buffer[(o_14+3)]===101&&buffer[(o_14+4)]===115&&buffer[(o_14+5)]===0){
                                                o_14+=6;
                                                if(type_17===4){
                                                    var arr_18=[];
                                                    var arrSize_19=readInt32LE_0(buffer,o_14);
                                                    var arrEnd_20=(o_14+(arrSize_19-1));
                                                    o_14+=4;
                                                    while(o_14<arrEnd_20){
                                                        var elemType_21=buffer[o_14];
                                                        o_14+=1;
                                                        if(elemType_21===0){
                                                            break;
                                                        }
                                                        o_14=skipCString_0(buffer,o_14);
                                                        var elem_22=undefined;
                                                        if(elemType_21===2){
                                                            var strLen_23=(((buffer[o_14]|(buffer[(o_14+1)]<<8))|((buffer[(o_14+2)]<<16)|(buffer[(o_14+3)]<<24)))-1);
                                                            o_14+=4;
                                                            elem_22=readBSONStringDirect_0(buffer,o_14,strLen_23);
                                                            o_14+=(strLen_23+1);
                                                        }else{
                                                            var strFallback_24=readStringValue_0(buffer,o_14,elemType_21);
                                                            elem_22=strFallback_24[0];
                                                            o_14+=strFallback_24[1];
                                                        }
                                                        arr_18.push(elem_22);
                                                    }
                                                    names_16=arr_18;
                                                    o_14=(arrEnd_20+1);
                                                }else{
                                                    throw makeBsonConversionError_0(type_17,"Array<string>");
                                                }
                                            }else{
                                                o_14=skipCString_0(buffer,o_14);
                                                o_14=skipValue_0(buffer,o_14,type_17);
                                            }
                                        }
                                    }
                                    var result_27={};
                                    result_27.id=id_15;
                                    if(names_16!==const_0){
                                        result_27.names=names_16;
                                    }
                                    var objResult_28=[result_27,(end_13+1)];
                                    owner_10=objResult_28[0];
                                    o_4=objResult_28[1];
                                }else{
                                    if((type_11===10||type_11===6)){
                                        throw makeBsonConversionError_0(type_11,"{id: number, names: array}");
                                    }else{
                                        o_4=skipValue_0(buffer,o_4,type_11);
                                    }
                                }
                            }
                        }else{
                            o_4=skipCString_0(buffer,o_4);
                            o_4=skipValue_0(buffer,o_4,type_11);
                        }
                    }
                }
            }
        }
    }
}
var result_65={};
result_65.id=id_5;
if(tags_6!==const_0){
    result_65.tags=tags_6;
}
if(meta_7!==const_0){
    result_65.meta=meta_7;
}else{
    throw makeBsonConversionError_0(6,"{}");
}
if(state_8!==const_0){
    result_65.state=state_8;
}else{
    throw makeUndefinedConversionError_0(6,"draft | live | gone");
}
if(shape_9!==const_0){
    result_65.shape=shape_9;
}else{
    throw makeUndefinedConversionError_0(6,"Shape");
}
if(owner_10!==const_0){
    result_65.owner=owner_10;
}else{
    throw makeBsonConversionError_0(6,"{id: number, names: array}");
}
return result_65;
}

// externals: readDouble_0, nanToZero_0, readNumberValue_0, const_0, const_1, readInt32LE_0, skipCString_0, readBSONStringDirect_0, readStringValue_0, skipValue_0, makeBsonConversionError_0, create_0, readCStringHelper_0, makeUnionNoMatchError_0, fn_0, fn_1, makeUndefinedConversionError_0
'use strict';
function _nfn_10(buffer,o,ft){
var ho_3=o;
var val_4=0;
if(ft===16){
    val_4=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
    ho_3+=4;
}else{
    if(ft===1){
        var dblVal_5=readDouble_0(buffer,ho_3);
        val_4=nanToZero_0(dblVal_5);
        ho_3+=8;
    }else{
        var numFallback_6=readNumberValue_0(buffer,ho_3,ft);
        val_4=numFallback_6[0];
        ho_3+=numFallback_6[1];
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_11(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===105&&buffer[(o+2)]===100&&buffer[(o+3)]===0){
        var do_4=(o+4);
        if(ft_3===16){
            const_0[0]=((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)));
            const_0[1]=(do_4+4);
            return;
        }
        _nfn_10(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=0;
const_0[1]=o;
}
function _nfn_12(buffer,o,ft){
var ho_3=o;
var val_4=const_1;
if(ft===4){
    var arr_5=[];
    var arrSize_6=readInt32LE_0(buffer,ho_3);
    var arrEnd_7=(ho_3+(arrSize_6-1));
    ho_3+=4;
    while(ho_3<arrEnd_7){
        var elemType_8=buffer[ho_3];
        ho_3+=1;
        if(elemType_8===0){
            break;
        }
        ho_3=skipCString_0(buffer,ho_3);
        var elem_9=undefined;
        if(elemType_8===3){
            var docSize_10=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
            var end_11=(ho_3+(docSize_10-1));
            var o_12=(ho_3+4);
            var id_13=0;
            var label_14="";
            while(o_12<end_11){
                var type_15=buffer[o_12];
                o_12+=1;
                if(type_15===0){
                    break;
                }
                if(buffer[o_12]===105&&buffer[(o_12+1)]===100&&buffer[(o_12+2)]===0){
                    o_12+=3;
                    if(type_15===16){
                        id_13=((buffer[o_12]|(buffer[(o_12+1)]<<8))|((buffer[(o_12+2)]<<16)|(buffer[(o_12+3)]<<24)));
                        o_12+=4;
                    }else{
                        if(type_15===1){
                            var dblVal_18=readDouble_0(buffer,o_12);
                            id_13=nanToZero_0(dblVal_18);
                            o_12+=8;
                        }else{
                            var numFallback_19=readNumberValue_0(buffer,o_12,type_15);
                            id_13=numFallback_19[0];
                            o_12+=numFallback_19[1];
                        }
                    }
                }else{
                    if(buffer[o_12]===108&&buffer[(o_12+1)]===97&&buffer[(o_12+2)]===98&&buffer[(o_12+3)]===101&&buffer[(o_12+4)]===108&&buffer[(o_12+5)]===0){
                        o_12+=6;
                        if(type_15===2){
                            var strLen_16=(((buffer[o_12]|(buffer[(o_12+1)]<<8))|((buffer[(o_12+2)]<<16)|(buffer[(o_12+3)]<<24)))-1);
                            o_12+=4;
                            label_14=readBSONStringDirect_0(buffer,o_12,strLen_16);
                            o_12+=(strLen_16+1);
                        }else{
                            var strFallback_17=readStringValue_0(buffer,o_12,type_15);
                            label_14=strFallback_17[0];
                            o_12+=strFallback_17[1];
                        }
                    }else{
                        o_12=skipCString_0(buffer,o_12);
                        o_12=skipValue_0(buffer,o_12,type_15);
                    }
                }
            }
            var result_20={};
            result_20.id=id_13;
            result_20.label=label_14;
            var objResult_21=[result_20,(end_11+1)];
            elem_9=objResult_21[0];
            ho_3=objResult_21[1];
        }else{
            if((elemType_8===10||elemType_8===6)){
                throw makeBsonConversionError_0(elemType_8,"{id: number, label: string}");
            }else{
                ho_3=skipValue_0(buffer,ho_3,elemType_8);
            }
        }
        arr_5.push(elem_9);
    }
    val_4=arr_5;
    ho_3=(arrEnd_7+1);
}else{
    throw makeBsonConversionError_0(ft,"Array<{id: number, label: string}>");
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_13(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===116&&buffer[(o+2)]===97&&buffer[(o+3)]===103&&buffer[(o+4)]===115&&buffer[(o+5)]===0){
        var do_4=(o+6);
        _nfn_12(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=const_1;
const_0[1]=o;
}
function _nfn_14(buffer,o,ft){
var ho_3=o;
var val_4=const_1;
if((ft===10||ft===6)){
    throw makeBsonConversionError_0(ft,"{}");
}else{
    if(ft===3){
        var docSize_5=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
        var end_6=(ho_3+(docSize_5-1));
        var o_7=(ho_3+4);
        var indexObj_8=create_0(null);
        while(o_7<end_6){
            var type_9=buffer[o_7];
            o_7+=1;
            if(type_9===0){
                break;
            }
            var nameResult_10=readCStringHelper_0(buffer,o_7);
            o_7+=nameResult_10[1];
            var indexVal_11=undefined;
            if(type_9===2){
                if(type_9===2){
                    var strLen_16=(((buffer[o_7]|(buffer[(o_7+1)]<<8))|((buffer[(o_7+2)]<<16)|(buffer[(o_7+3)]<<24)))-1);
                    o_7+=4;
                    indexVal_11=readBSONStringDirect_0(buffer,o_7,strLen_16);
                    o_7+=(strLen_16+1);
                }else{
                    var strFallback_17=readStringValue_0(buffer,o_7,type_9);
                    indexVal_11=strFallback_17[0];
                    o_7+=strFallback_17[1];
                }
            }else{
                if((type_9===16||type_9===1)){
                    if(type_9===16){
                        indexVal_11=((buffer[o_7]|(buffer[(o_7+1)]<<8))|((buffer[(o_7+2)]<<16)|(buffer[(o_7+3)]<<24)));
                        o_7+=4;
                    }else{
                        if(type_9===1){
                            var dblVal_14=readDouble_0(buffer,o_7);
                            indexVal_11=nanToZero_0(dblVal_14);
                            o_7+=8;
                        }else{
                            var numFallback_15=readNumberValue_0(buffer,o_7,type_9);
                            indexVal_11=numFallback_15[0];
                            o_7+=numFallback_15[1];
                        }
                    }
                }else{
                    if(type_9===8){
                        if(type_9===16){
                            indexVal_11=((buffer[o_7]|(buffer[(o_7+1)]<<8))|((buffer[(o_7+2)]<<16)|(buffer[(o_7+3)]<<24)));
                            o_7+=4;
                        }else{
                            if(type_9===1){
                                var dblVal_12=readDouble_0(buffer,o_7);
                                indexVal_11=nanToZero_0(dblVal_12);
                                o_7+=8;
                            }else{
                                var numFallback_13=readNumberValue_0(buffer,o_7,type_9);
                                indexVal_11=numFallback_13[0];
                                o_7+=numFallback_13[1];
                            }
                        }
                    }else{
                        throw makeUnionNoMatchError_0(type_9,"string | number");
                    }
                }
            }
            indexObj_8[nameResult_10[0]]=indexVal_11;
        }
        var result_18=indexObj_8;
        var objResult_19=[result_18,(end_6+1)];
        val_4=objResult_19[0];
        ho_3=objResult_19[1];
    }else{
        if((ft===10||ft===6)){
            throw makeBsonConversionError_0(ft,"{}");
        }else{
            ho_3=skipValue_0(buffer,ho_3,ft);
        }
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_15(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===109&&buffer[(o+2)]===101&&buffer[(o+3)]===116&&buffer[(o+4)]===97&&buffer[(o+5)]===0){
        var do_4=(o+6);
        _nfn_14(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=const_1;
const_0[1]=o;
}
function _nfn_16(buffer,o,ft){
var ho_3=o;
var val_4=const_1;
if(ft===2){
    var litStr_5=readStringValue_0(buffer,ho_3,ft);
    val_4=litStr_5[0];
    ho_3+=litStr_5[1];
}else{
    throw makeUnionNoMatchError_0(ft,"draft | live | gone");
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_17(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===115&&buffer[(o+2)]===116&&buffer[(o+3)]===97&&buffer[(o+4)]===116&&buffer[(o+5)]===101&&buffer[(o+6)]===0){
        var do_4=(o+7);
        _nfn_16(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=const_1;
const_0[1]=o;
}
function _nfn_18(buffer,o,ft){
var ho_3=o;
var val_4=const_1;
if(ft===3){
    var multiObjResult_5=fn_0(buffer,ho_3);
    val_4=multiObjResult_5[0];
    ho_3=multiObjResult_5[1];
}else{
    throw makeUnionNoMatchError_0(ft,"Shape");
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_19(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===115&&buffer[(o+2)]===104&&buffer[(o+3)]===97&&buffer[(o+4)]===112&&buffer[(o+5)]===101&&buffer[(o+6)]===0){
        var do_4=(o+7);
        _nfn_18(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=const_1;
const_0[1]=o;
}
function _nfn_20(buffer,o,ft){
var ho_3=o;
var val_4=const_1;
if((ft===10||ft===6)){
    throw makeBsonConversionError_0(ft,"{id: number, names: array}");
}else{
    if(ft===3){
        var docSize_5=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
        var end_6=(ho_3+(docSize_5-1));
        var o_7=(ho_3+4);
        var id_8=0;
        var names_9=const_1;
        while(o_7<end_6){
            var type_10=buffer[o_7];
            o_7+=1;
            if(type_10===0){
                break;
            }
            if(buffer[o_7]===105&&buffer[(o_7+1)]===100&&buffer[(o_7+2)]===0){
                o_7+=3;
                if(type_10===16){
                    id_8=((buffer[o_7]|(buffer[(o_7+1)]<<8))|((buffer[(o_7+2)]<<16)|(buffer[(o_7+3)]<<24)));
                    o_7+=4;
                }else{
                    if(type_10===1){
                        var dblVal_18=readDouble_0(buffer,o_7);
                        id_8=nanToZero_0(dblVal_18);
                        o_7+=8;
                    }else{
                        var numFallback_19=readNumberValue_0(buffer,o_7,type_10);
                        id_8=numFallback_19[0];
                        o_7+=numFallback_19[1];
                    }
                }
            }else{
                if(buffer[o_7]===110&&buffer[(o_7+1)]===97&&buffer[(o_7+2)]===109&&buffer[(o_7+3)]===101&&buffer[(o_7+4)]===115&&buffer[(o_7+5)]===0){
                    o_7+=6;
                    if(type_10===4){
                        var arr_11=[];
                        var arrSize_12=readInt32LE_0(buffer,o_7);
                        var arrEnd_13=(o_7+(arrSize_12-1));
                        o_7+=4;
                        while(o_7<arrEnd_13){
                            var elemType_14=buffer[o_7];
                            o_7+=1;
                            if(elemType_14===0){
                                break;
                            }
                            o_7=skipCString_0(buffer,o_7);
                            var elem_15=undefined;
                            if(elemType_14===2){
                                var strLen_16=(((buffer[o_7]|(buffer[(o_7+1)]<<8))|((buffer[(o_7+2)]<<16)|(buffer[(o_7+3)]<<24)))-1);
                                o_7+=4;
                                elem_15=readBSONStringDirect_0(buffer,o_7,strLen_16);
                                o_7+=(strLen_16+1);
                            }else{
                                var strFallback_17=readStringValue_0(buffer,o_7,elemType_14);
                                elem_15=strFallback_17[0];
                                o_7+=strFallback_17[1];
                            }
                            arr_11.push(elem_15);
                        }
                        names_9=arr_11;
                        o_7=(arrEnd_13+1);
                    }else{
                        throw makeBsonConversionError_0(type_10,"Array<string>");
                    }
                }else{
                    o_7=skipCString_0(buffer,o_7);
                    o_7=skipValue_0(buffer,o_7,type_10);
                }
            }
        }
        var result_20={};
        result_20.id=id_8;
        if(names_9!==const_1){
            result_20.names=names_9;
        }
        var objResult_21=[result_20,(end_6+1)];
        val_4=objResult_21[0];
        ho_3=objResult_21[1];
    }else{
        if((ft===10||ft===6)){
            throw makeBsonConversionError_0(ft,"{id: number, names: array}");
        }else{
            ho_3=skipValue_0(buffer,ho_3,ft);
        }
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_21(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===111&&buffer[(o+2)]===119&&buffer[(o+3)]===110&&buffer[(o+4)]===101&&buffer[(o+5)]===114&&buffer[(o+6)]===0){
        var do_4=(o+7);
        _nfn_20(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=const_1;
const_0[1]=o;
}
return function(buffer,offset=0){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var id_5=0;
var tags_6=const_1;
var meta_7=const_1;
var state_8=const_1;
var shape_9=const_1;
var owner_10=const_1;
_nfn_11(buffer,o_4,end_3);
id_5=const_0[0];
o_4=const_0[1];
_nfn_13(buffer,o_4,end_3);
tags_6=const_0[0];
o_4=const_0[1];
_nfn_15(buffer,o_4,end_3);
meta_7=const_0[0];
o_4=const_0[1];
_nfn_17(buffer,o_4,end_3);
state_8=const_0[0];
o_4=const_0[1];
_nfn_19(buffer,o_4,end_3);
shape_9=const_0[0];
o_4=const_0[1];
_nfn_21(buffer,o_4,end_3);
owner_10=const_0[0];
o_4=const_0[1];
if(buffer[o_4]!==0){
    return fn_1(buffer,offset);
}
var result_11={};
result_11.id=id_5;
if(tags_6!==const_1){
    result_11.tags=tags_6;
}
if(meta_7!==const_1){
    result_11.meta=meta_7;
}else{
    throw makeBsonConversionError_0(6,"{}");
}
if(state_8!==const_1){
    result_11.state=state_8;
}else{
    throw makeUndefinedConversionError_0(6,"draft | live | gone");
}
if(shape_9!==const_1){
    result_11.shape=shape_9;
}else{
    throw makeUndefinedConversionError_0(6,"Shape");
}
if(owner_10!==const_1){
    result_11.owner=owner_10;
}else{
    throw makeBsonConversionError_0(6,"{id: number, names: array}");
}
return result_11;
}

// externals: const_0
'use strict';
return function(buf,offset){
var ds_2=((buf[offset]|(buf[(offset+1)]<<8))|((buf[(offset+2)]<<16)|(buf[(offset+3)]<<24)));
var end_3=(offset+(ds_2-1));
var o_4=(offset+4);
if(o_4>=end_3){
    return const_0;
}
if(!(buf[o_4]===2&&buf[(o_4+1)]===107&&buf[(o_4+2)]===105&&buf[(o_4+3)]===110&&buf[(o_4+4)]===100&&buf[(o_4+5)]===0)){
    return const_0;
}
var d_5=(o_4+6);
var _f0_6=undefined;
_f0_6="rect";
var litSl_7=((buf[d_5]|(buf[(d_5+1)]<<8))|((buf[(d_5+2)]<<16)|(buf[(d_5+3)]<<24)));
o_4=(d_5+(4+litSl_7));
if(o_4>=end_3){
    return const_0;
}
if(!(buf[o_4]===16&&buf[(o_4+1)]===119&&buf[(o_4+2)]===0)){
    return const_0;
}
var d_8=(o_4+3);
var _f1_9=undefined;
_f1_9=((buf[d_8]|(buf[(d_8+1)]<<8))|((buf[(d_8+2)]<<16)|(buf[(d_8+3)]<<24)));
o_4=(d_8+4);
if(o_4>=end_3){
    return const_0;
}
if(!(buf[o_4]===16&&buf[(o_4+1)]===104&&buf[(o_4+2)]===0)){
    return const_0;
}
var d_10=(o_4+3);
var _f2_11=undefined;
_f2_11=((buf[d_10]|(buf[(d_10+1)]<<8))|((buf[(d_10+2)]<<16)|(buf[(d_10+3)]<<24)));
o_4=(d_10+4);
if(buf[o_4]!==0){
    return const_0;
}
var result_12={};
result_12["kind"]=_f0_6;
result_12["w"]=_f1_9;
result_12["h"]=_f2_11;
return [result_12,(offset+ds_2)];
}

// externals: fn_0, const_0, fn_1, onBailout_0
'use strict';
return function(buf,offset=0){
var fb_2=buf[(offset+5)];
if(fb_2===107){
    var r_3=fn_0(buf,offset);
    if(r_3!==const_0){
        return r_3;
    }
    return fn_1(buf,offset);
}
return onBailout_0(buf,offset);
}
